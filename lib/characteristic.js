const debug = require('debug')('characteristic');

const events = require('events');
const util = require('util');

const characteristics = require('./characteristics.json');

class Characteristic extends events.EventEmitter {
  constructor(noble, peripheralId, serviceUuid, uuid, properties) {
    super();
    this._noble = noble;
    this._peripheralId = peripheralId;
    this._serviceUuid = serviceUuid;

    this.uuid = uuid;
    this.name = null;
    this.type = null;
    this.properties = properties;
    this.descriptors = null;

    const characteristic = characteristics[uuid];
    if (characteristic) {
      this.name = characteristic.name;
      this.type = characteristic.type;
    }
  }

  read() {
    return new Promise((resolve, reject) => {
      const onRead = (data, isNotificaton) => {
        // only call the callback if 'read' event and non-notification
        // 'read' for non-notifications is only present for backwards compatbility
        if (!isNotificaton) {
          // remove the listener
          this.removeListener('read', onRead);
          resolve(data);
        }
      };

      this.on('read', onRead);

      this._noble.read(
        this._peripheralId,
        this._serviceUuid,
        this.uuid
      );
    });
  }

  write(data, withoutResponse, callback) {
    if (process.title !== 'browser') {
      if (!(data instanceof Buffer)) {
        throw new Error('data must be a Buffer');
      }
    }

    if (callback) {
      this.once('write', function() {
        callback(null);
      });
    }

    this._noble.write(
      this._peripheralId,
      this._serviceUuid,
      this.uuid,
      data,
      withoutResponse
    );
  }

  broadcast(broadcast, callback) {
    if (callback) {
      this.once('broadcast', function() {
        callback(null);
      });
    }

    this._noble.broadcast(
      this._peripheralId,
      this._serviceUuid,
      this.uuid,
      broadcast
    );
  }

  notify(notify, callback) {
    if (callback) {
      this.once('notify', function() {
        callback(null);
      });
    }

    this._noble.notify(
      this._peripheralId,
      this._serviceUuid,
      this.uuid,
      notify
    );
  }

  subscribe(callback) {
    this.notify(true, callback);
  }

  unsubscribe(callback) {
    this.notify(false, callback);
  }

  discoverDescriptors(callback) {
    if (!this.discoverPromise) {
      this.discoverPromise = new Promise((resolve, reject) => {
        this.once('descriptorsDiscover', (descriptors) => {
          resolve(descriptors);
          this.discoverPromise = null;
        });

        this._noble.discoverDescriptors(
          this._peripheralId,
          this._serviceUuid,
          this.uuid
        );
      });
    }
    return this.discoverPromise;
  }

  toString() {
    return JSON.stringify({
      uuid: this.uuid,
      name: this.name,
      type: this.type,
      properties: this.properties
    });
  }
}

module.exports = Characteristic;
