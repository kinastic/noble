const debug = require('debug')('service');

const events = require('events');
const util = require('util');

const services = require('./services.json');

class Service extends events.EventEmitter {
  constructor(noble, peripheralId, uuid) {
    super();
    this._noble = noble;
    this._peripheralId = peripheralId;
  
    this.uuid = uuid;
    this.name = null;
    this.type = null;
    this.includedServiceUuids = null;
    this.characteristics = null;
  
    const service = services[uuid];
    if (service) {
      this.name = service.name;
      this.type = service.type;
    }
  }
  
  discoverIncludedServices(serviceUuids, callback) {
    if (callback) {
      this.once('includedServicesDiscover', function(includedServiceUuids) {
        callback(null, includedServiceUuids);
      });
    }
    
    this._noble.discoverIncludedServices(
      this._peripheralId,
      this.uuid,
      serviceUuids
    );
  }
  
  discoverCharacteristics(characteristicUuids, callback) {
    if (callback) {
      this.once('characteristicsDiscover', function(characteristics) {
        callback(null, characteristics);
      });
    }
    
    this._noble.discoverCharacteristics(
      this._peripheralId,
      this.uuid,
      characteristicUuids
    );
  }
  
  toString() {
    return JSON.stringify({
      uuid: this.uuid,
      name: this.name,
      type: this.type,
      includedServiceUuids: this.includedServiceUuids
    });
  }
}

module.exports = Service;
