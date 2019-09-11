import { __ } from 'embark-i18n';
import { BlockchainClient } from "../geth/blockchain";
const { normalizeInput } = require('embark-utils');
import { BlockchainProcessLauncher } from './blockchainProcessLauncher';
import { ws, rpc } from './check.js';
const constants = require('embark-core/constants');

class Parity {

  constructor(embark, options) {
    this.embark = embark;
    this.embarkConfig = embark.config.embarkConfig;
    this.blockchainConfig = embark.config.blockchainConfig;
    this.locale = options.locale;
    this.logger = embark.logger;
    this.client = options.client;
    this.isDev = options.isDev;
    this.events = embark.events;
    this.plugins = options.plugins;
    // let plugin = this.plugins.createPlugin('gethplugin', {});

    if (!this.shouldInit()) {
      return;
    }

    this.events.request("blockchain:node:register", constants.blockchain.clients.parity,
      (isStartedCb) => {
        this._suppressConnectionOpenError(true);
        this._doCheck((state) => {
          this._suppressConnectionOpenError(false);
          return isStartedCb(null, state.status === "on");
        });
      },
      (readyCb) => {
        this._suppressConnectionOpenError(true);
        this.events.request('processes:register', 'blockchain', {
          launchFn: (cb) => {
            // this.startBlockchainNode(readyCb);
            this.startBlockchainNode(cb);
          },
          stopFn: (cb) => {
            this.stopBlockchainNode(cb);
          }
        });
        this.events.request("processes:launch", "blockchain", (err) => {
          this._suppressConnectionOpenError(false);
          if (err) {
            this.logger.error(`Error launching blockchain process: ${err.message || err}`);
          }
          readyCb();
        });
        this.registerServiceCheck();
      });
  }

  shouldInit() {
    return (
      this.blockchainConfig.client === constants.blockchain.clients.geth &&
      this.blockchainConfig.enabled
    );
  }

  _getNodeState(err, version, cb) {
    if (err) return cb({ name: "Ethereum node not found", status: 'off' });

    let nodeName = "parity";
    let versionNumber = version.split("-")[0];
    let name = nodeName + " " + versionNumber + " (Ethereum)";
    return cb({ name, status: 'on' });
  }

  _doCheck(cb) {
    const { rpcHost, rpcPort, wsRPC, wsHost, wsPort } = this.blockchainConfig;
    if (wsRPC) {
      return ws(wsHost, wsPort + 10, (err, version) => this._getNodeState(err, version, cb));
    }
    rpc(rpcHost, rpcPort + 10, (err, version) => this._getNodeState(err, version, cb));
  }

  _suppressConnectionOpenError(enable) {
    if (!enable) {
      console.error = this.ogConsoleError;
      return;
    }
    this.ogConsoleError = console.error;
    // TODO remove this once we update to web3 2.0
    // TODO in web3 1.0, it console.errors "connection not open on send()" even if we catch the error
    console.error = (...args) => {
      if (args[0].indexOf('connection not open on send()') > -1) {
        return;
      }
      this.ogConsoleError(...args);
    };
  }

  // TODO: need to get correct port taking into account the proxy
  registerServiceCheck() {
    this.events.request("services:register", 'Ethereum', this._doCheck.bind(this), 5000, 'off');
  }

  startBlockchainNode(callback) {
    if (this.blockchainConfig.isStandalone) {
      return BlockchainClient(this.blockchainConfig, {
        clientName: 'parity',
        env: this.embark.env,
        certOptions: this.embark.config.webServerConfig.certOptions,
        logger: this.logger,
        events: this.events,
        isStandalone: true,
        fs: this.embark.fs
      }).run();
    }

    this.blockchainProcess = new BlockchainProcessLauncher({
      events: this.events,
      logger: this.logger,
      normalizeInput,
      blockchainConfig: this.blockchainConfig,
      locale: this.locale,
      client: this.client,
      isDev: this.isDev,
      embark: this.embark
    });

    this.blockchainProcess.startBlockchainNode(callback);
  }

  stopBlockchainNode(cb) {
    const message = __(`The blockchain process has been stopped. It can be restarted by running ${"service blockchain on".bold} in the Embark console.`);

    if (!this.blockchainProcess) {
      return cb();
    }

    this.blockchainProcess.stopBlockchainNode(() => {
      this.logger.info(message);
      cb();
    });
  }

}

module.exports = Parity;
