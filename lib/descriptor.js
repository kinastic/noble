const debug = require('debug')('descriptor');

const events = require('events');
const util = require('util');

const descriptors = require('./descriptors.json');

class Descriptor extends events.EventEmitter {
  constructor(noble, peripheralId, serviceUuid, characteristicUuid, uuid) {
    super();
    this._noble = noble;
    this._peripheralId = peripheralId;
    this._serviceUuid = serviceUuid;
    this._characteristicUuid = characteristicUuid;

    this.uuid = uuid;
    this.name = null;
    this.type = null;

    const descriptor = descriptors[uuid];
    if (descriptor) {
      this.name = descriptor.name;
      this.type = descriptor.type;
    }
  }

  writeValue(data, callback) {
    if (!(data instanceof Buffer)) {
      throw new Error('data must be a Buffer');
    }

    if (callback) {
      this.once('valueWrite', () => {
        callback(null);
      });
    }
    this._noble.writeValue(
      this._peripheralId,
      this._serviceUuid,
      this._characteristicUuid,
      this.uuid,
      data
    );
  }

  readValue(callback) {
    if (callback) {
      this.once('valueRead', (data) => {
        callback(null, data);
      });
    }
    this._noble.readValue(
      this._peripheralId,
      this._serviceUuid,
      this._characteristicUuid,
      this.uuid
    );
  }

  toString() {
    return JSON.stringify({
      uuid: this.uuid,
      name: this.name,
      type: this.type
    });
  }
}

module.exports = Descriptor;
