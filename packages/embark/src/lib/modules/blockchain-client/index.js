const Web3 = require('web3');
const async = require('async');

class BlockchainClient {

  constructor(embark, options) {
    this.embark = embark;
    this.events = embark.events;

    this.blockchainClients = {};
    this.client = null;
    this.events.setCommandHandler("blockchain:client:register", (clientName, blockchainClient) => {
      this.blockchainClients[clientName] = blockchainClient;
      this.client = blockchainClient;
    });

    // TODO: unclear currently if this belongs here so it's a bit hardcoded for now
    this.events.setCommandHandler("blockchain:client:provider", (clientName, cb) => {
      this.events.request("proxy:endpoint", (err, endpoint) => {
        if (err) {
          return cb(err);
        }
        const web3 = new Web3(endpoint);
        cb(null, web3.currentProvider);
      });
    });

    // TODO: maybe not the ideal event to listen to?
    // for e.g, could wait for all stack components to be ready
    // TODO: probably better to have 2 stages in engine, services start, then connections, etc..
    this.events.on("blockchain:started", (clientName) => {
      // make connections
      // this.client.initAndConnect(); // and config options
      // should do stuff like
      // connect to endpoint given
      // set default account
    });

    this.registerAPIRequests();
  }

  get web3() {
    return (async () => {
      if (!this._web3) {
        const provider = await this.events.request2("blockchain:client:provider", "ethereum");
        this._web3 = new Web3(provider);
      }
      return this._web3;
    })();
  }

  async getAccounts(cb) {
    const web3 = await this.web3;
    return web3.eth.getAccounts(cb);
  }

  async getAccountsWithTransactionCount(callback) {
    let self = this;
    const addresses = await this.getAccounts();
    let accounts = [];
    async.eachOf(addresses, (address, index, eachCb) => {
      let account = {address, index};
      async.waterfall([
        function(callback) {
          self.getTransactionCount(address, (err, count) => {
            if (err) {
              self.logger.error(err);
              account.transactionCount = 0;
            } else {
              account.transactionCount = count;
            }
            callback(null, account);
          });
        },
        function(account, callback) {
          self.getBalance(address, (err, balance) => {
            if (err) {
              self.logger.error(err);
              account.balance = 0;
            } else {
              account.balance = self.web3.utils.fromWei(balance);
            }
            callback(null, account);
          });
        }
      ], function(_err, account) {
        accounts.push(account);
        eachCb();
      });
    }, function() {
      callback(accounts);
    });
  }

  getAccountForAPI(address, callback) {
    const self = this;
    async.waterfall([
      function(next) {
        self.getAccountsWithTransactionCount((accounts) => {
          let account = accounts.find((a) => a.address === address);
          if (!account) {
            return next("No account found with this address");
          }
          next(null, account);
        });
      },
      function(account, next) {
        self.getBlockNumber((err, blockNumber) => {
          if (err) {
            self.logger.error(err);
            next(err);
          } else {
            next(null, blockNumber, account);
          }
        });
      },
      function(blockNumber, account, next) {
        self.getTransactions(blockNumber - BLOCK_LIMIT, BLOCK_LIMIT, (transactions) => {
          account.transactions = transactions.filter((transaction) => transaction.from === address);
          next(null, account);
        });
      }
    ], function(err, result) {
      if (err) {
        callback();
      }
      callback(result);
    });
  }

  registerAPIRequests() {
    this.embark.registerAPICall(
      'get',
      '/embark-api/blockchain/accounts',
      (req, res) => {
        this.getAccountsWithTransactionCount(res.send.bind(res));
      }
    );

    this.embark.registerAPICall(
      'get',
      '/embark-api/blockchain/accounts/:address',
      (req, res) => {
        this.getAccountForAPI(req.params.address, res.send.bind(res));
      }
    );

    this.embark.registerAPICall(
      'get',
      '/embark-api/blockchain/blocks',
      (req, res) => {
        const from = parseInt(req.query.from, 10);
        const limit = req.query.limit || 10;
        this.getBlocks(from, limit, !!req.query.txObjects, !!req.query.txReceipts, res.send.bind(res));
      }
    );

    this.embark.registerAPICall(
      'get',
      '/embark-api/blockchain/blocks/:blockNumber',
      (req, res) => {
        this.getBlock(req.params.blockNumber, (err, block) => {
          if (err) {
            this.logger.error(err);
          }
          res.send(block);
        });
      }
    );

    this.embark.registerAPICall(
      'get',
      '/embark-api/blockchain/transactions',
      (req, res) => {
        let blockFrom = parseInt(req.query.blockFrom, 10);
        let blockLimit = req.query.blockLimit || 10;
        this.getTransactions(blockFrom, blockLimit, res.send.bind(res));
      }
    );

    this.embark.registerAPICall(
      'get',
      '/embark-api/blockchain/transactions/:hash',
      (req, res) => {
        this.getTransactionByHash(req.params.hash, (err, transaction) => {
          if (!err) return res.send(transaction);

          this.getTransactionByRawTransactionHash(req.params.hash, (err, transaction) => {
            if (err) return res.send({error: "Could not find or decode transaction hash"});
            res.send(transaction);
          });
        });
      }
    );

    this.embark.registerAPICall(
      'ws',
      '/embark-api/blockchain/blockHeader',
      (ws) => {
        this.events.on('block:header', (block) => {
          ws.send(JSON.stringify({block: block}), () => {
          });
        });
      }
    );

    this.embark.registerAPICall(
      'post',
      '/embark-api/messages/sign',
      (req, res) => {
        const signer = req.body.address;
        const message = req.body.message;
        this.web3.eth.sign(message, signer).then(signature => {
          res.send({signer, signature, message});
        }).catch(e => res.send({error: e.message}));
      }
    );

    this.embark.registerAPICall(
      'post',
      '/embark-api/messages/verify',
      (req, res) => {
        let signature;
        try {
          signature = JSON.parse(req.body.message);
        } catch (e) {
          return res.send({error: e.message});
        }

        this.web3.eth.personal.ecRecover(signature.message, signature.signature)
          .then(address => res.send({address}))
          .catch(e => res.send({error: e.message}));
      }
    );
  }
}

module.exports = BlockchainClient;
