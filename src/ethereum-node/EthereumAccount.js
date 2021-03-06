const Web3 = require('web3');
const fs = require('fs');
const solc = require('solc');

const GasLimiter = require('./GasLimiter');

class EthereumAccount {

    constructor(url, coinBase, password) {
        this._web3 = new Web3(new Web3.providers.HttpProvider(url));
        this._coinBase = coinBase;
        this._password = password;
    }

    get coinBase() {
        return this._coinBase;
    }

    async getBalance() {
        const balance = await this._web3.eth.getBalance(this.coinBase);
        return this._web3.utils.fromWei(balance);
    }

    /**
     * 
     * @param {string} contractPath 
     * @param {PluginParams} contractAddress 
     */
    async initContract(contractPath, params, args = []) {
        await this.unlockAccount();
        const file = fs.readFileSync(contractPath, 'utf8');

        const compiled = solc.compile(file);
        let data, abi;
        for (let contractName in compiled.contracts) {
            data = `0x${compiled.contracts[contractName].bytecode}`;
            abi = JSON.parse(compiled.contracts[contractName].interface);
        }

        let contract;

        if (this._web3.utils.isAddress(params.contractAddress)) {

            const initTransaction = await this._web3.eth.getTransaction(params.initialTransactionHash);
            if (initTransaction && initTransaction.input.indexOf(data) !== -1) {
                contract = new this._web3.eth.Contract(abi, params.contractAddress);
                return contract;
            }

        }
        contract = new this._web3.eth.Contract(abi);

        const gasCost = await contract.deploy({
            data: data,
            arguments: args
        })
            .estimateGas();

        const payable = this.checkPayablePossibility(gasCost);

        if (payable && GasLimiter.pay(gasCost)) {
            contract = await this.deployContract(contract,data,args,gasCost);
        } else {
            throw new Error('Not enough ethereum to deploy contract');
        }
        return contract;
    }

    /**
     * 
     * @param {Object} contract 
     * @param {String} data 
     * @param {Array<Any>} args 
     * @param {Number} gasCost 
     */
    deployContract(contract, data, args, gasCost) {
        return new Promise((resolve, reject) => {
            const contractPromise = contract.deploy({data: data, arguments: args})
                .send({ from: this._coinBase, gas: gasCost })
                .on('error', err => reject(err))
                .on('transactionHash', transactionHash => {
                    contractPromise.then((newContractInstance) => {
                        newContractInstance.initialTransactionHash = transactionHash;
                        resolve(newContractInstance);
                    }).catch(reject);
                }).catch(reject);
        });
    }

    /**
     * 
     * @param {number} gasAmount 
     * 
     * @returns {Boolean}
     */
    async checkPayablePossibility(gasAmount) {
        const gasPrice = this._web3.utils.fromWei(await this._web3.eth.getGasPrice());
        const ethCost = gasAmount * gasPrice;
        return await this.getBalance() >= ethCost;
    }

    async unlockAccount() {
        await this._web3.eth.personal.unlockAccount(this._coinBase, this._password);
    }
}


module.exports = EthereumAccount;
