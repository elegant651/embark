import {__} from 'embark-i18n';
// import {canonicalHost, defaultHost} from 'embark-utils';

export default class Namesystem {
  constructor(embark, _options) {
    this.embark = embark;
    this.events = this.embark.events;
    this.embarkConfig = embark.config.embarkConfig;
    this.namesystemConfig = this.embark.config.namesystemConfig;

    this.namesystemNodes = {};

    this.registerCommandHandlers();
    embark.registerActionForEvent("pipeline:generateAll:before", this.addArtifactFile.bind(this));
  }

  registerCommandHandlers() {
    this.events.setCommandHandler("namesystem:node:register", (nodeName, startFunction, executeCommand) => {
      this.namesystemNodes[nodeName] = {startFunction, executeCommand, started: false};
    });

    this.events.setCommandHandler("namesystem:node:start", (namesystemConfig, cb) => {
      const nodeName = namesystemConfig.provider;
      const client = this.namesystemNodes[nodeName];
      if (!client) return cb(__("Namesystem client %s not found", nodeName));

      client.startFunction.apply(client, [
        () => {
          client.started = true;
          cb();
        }
      ]);
    });

    this.events.setCommandHandler("namesystem:resolve", (name, cb) => {
      this.executeNodeCommand('resolve', [name], cb);
    });

    this.events.setCommandHandler("namesystem:lookup", (address, cb) => {
      this.executeNodeCommand('lookup', [address], cb);
    });

    this.events.setCommandHandler("namesystem:registerSubdomain", (name, address, cb) => {
      this.executeNodeCommand('registerSubdomain', [name, address], cb);
    });
  }

  executeNodeCommand(command, args, cb) {
    const startedNode = Object.values(this.namesystemNodes).find(node => node.started);

    if (!startedNode) {
      return cb(__("No namesystem client started"));
    }

    startedNode.executeCommand(command, args, cb);
  }

  async addArtifactFile(_params, cb) {
    // FIXME this shouldn't be done as the stack component calls the plugins
    // FIXME this will be refactored along with the ENS plugin refactor
    this.events.request("ens:config", (config) => {
      this.events.request("pipeline:register", {
        path: [this.embarkConfig.generationDir, 'config'],
        file: 'namesystem.json',
        format: 'json',
        content: Object.assign({}, this.namesystemConfig, config)
      }, cb);
    });
  }
}
