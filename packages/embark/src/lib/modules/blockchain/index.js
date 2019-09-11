import async from 'async';
const { __ } = require('embark-i18n');
const constants = require('embark-core/constants');

import BlockchainAPI from "./api";
class Blockchain {

  constructor(embark) {
    this.embarkConfig = embark.config.embarkConfig;
    this.logger = embark.logger;
    this.events = embark.events;
    this.blockchainConfig = embark.config.blockchainConfig;
    this.contractConfig = embark.config.contractConfig;
    this.blockchainApi = new BlockchainAPI(embark);
    this.startedClient = null;

    embark.registerActionForEvent("pipeline:generateAll:before", this.addArtifactFile.bind(this));

    this.blockchainNodes = {};
    this.events.setCommandHandler("blockchain:node:register", (clientName, { isStartedFn, launchFn, stopFn }) => {
      this.blockchainNodes[clientName] = { isStartedFn, launchFn, stopFn };
    });

    this.events.setCommandHandler("blockchain:node:start", (blockchainConfig, cb) => {
      const self = this;
      const clientName = blockchainConfig.client;
      function started() {
        self.startedClient = clientName;
        self.events.emit("blockchain:started", clientName);
      }
      if (clientName === constants.blockchain.vm) {
        started();
        return cb();
      }

      const client = this.blockchainNodes[clientName];

      if (!client) return cb(`Blockchain client '${clientName}' not found, please register this node using 'blockchain:node:register'.`);
      if (!client.isStartedFn) return cb(`Blockchain client '${clientName}' has no 'isStarted' function registered, please register one using 'blockchain:node:register'.`);
      if (!client.launchFn) return cb(`Blockchain client '${clientName}' has no launch function registered, please register one using 'blockchain:node:register'.`);
      if (!client.stopFn) return cb(`Blockchain client '${clientName}' has no stop function registered, please register one using 'blockchain:node:register'.`);

      // check if we should should start
      client.isStartedFn.call(client, (err, isStarted) => {
        if (err) {
          return cb(err);
        }
        if (isStarted) {
          // Node may already be started
          started();
          return cb(null, true);
        }
        // start node
        client.launchFn.call(client, () => {
          started();
          cb();
        });
      });
    });

    this.events.setCommandHandler("blockchain:node:stop", (clientName, cb) => {
      if (typeof clientName === 'function') {
        if (!this.startedClient) {
          return cb(__('No blockchain client is currently started'));
        }
        cb = clientName;
        clientName = this.startedClient;
      }

      if (clientName === constants.blockchain.vm) {
        this.startedClient = null;
        this.events.emit("blockchain:stopped", clientName);
        return cb();
      }

      const clientFunctions = this.blockchainNodes[clientName];
      if (!clientFunctions) {
        return cb(__("Client %s not found", clientName));
      }

      clientFunctions.stopFn.apply(clientFunctions, [
        () => {
          this.events.emit("blockchain:stopped", clientName);
          cb();
        }
      ]);
      this.startedClient = null;
    });
    this.blockchainApi.registerAPIs("ethereum");
    this.blockchainApi.registerRequests("ethereum");
  }

  addArtifactFile(_params, cb) {
    this.events.request("config:contractsConfig", (_err, contractsConfig) => {
      async.map(contractsConfig.dappConnection, (conn, mapCb) => {
        if (conn === '$EMBARK') {
          // Connect to Embark's endpoint (proxy)
          return this.events.request("proxy:endpoint:get", mapCb);
        }
        mapCb(null, conn);
      }, (err, results) => {
        if (err) {
          this.logger.error(__('Error getting dapp connection'));
          return cb(err);
        }
        let config = {
          provider: contractsConfig.library || 'web3',
          dappConnection: results,
          dappAutoEnable: contractsConfig.dappAutoEnable,
          warnIfMetamask: this.blockchainConfig.isDev,
          blockchainClient: this.blockchainConfig.client
        };

        this.events.request("pipeline:register", {
          path: [this.embarkConfig.generationDir, 'config'],
          file: 'blockchain.json',
          format: 'json',
          content: config
        }, cb);
      });
    });
  }

}

module.exports = Blockchain;
