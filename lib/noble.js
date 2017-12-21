const debug = require('debug')('noble');

const events = require('events');
const util = require('util');

const Peripheral = require('./peripheral');
const Service = require('./service');
const Characteristic = require('./characteristic');
const Descriptor = require('./descriptor');

class Noble extends events.EventEmitter {
  constructor(bindings) {
    super();
    this.initialized = false;

    this.address = 'unknown';
    this._state = 'unknown';
    this._bindings = bindings;
    this._peripherals = {};
    this._services = {};
    this._characteristics = {};
    this._descriptors = {};
    this._discoveredPeripheralUUids = [];

    this._bindings.on('stateChange', this.onStateChange.bind(this));
    this._bindings.on('addressChange', this.onAddressChange.bind(this));
    this._bindings.on('scanStart', this.onScanStart.bind(this));
    this._bindings.on('scanStop', this.onScanStop.bind(this));
    this._bindings.on('discover', this.onDiscover.bind(this));
    // this._bindings.on('connect', this.onConnect.bind(this));
    this._bindings.on('disconnect', this.onDisconnect.bind(this));
    this._bindings.on('rssiUpdate', this.onRssiUpdate.bind(this));
    this._bindings.on('servicesDiscover', this.onServicesDiscover.bind(this));
    this._bindings.on('includedServicesDiscover', this.onIncludedServicesDiscover.bind(this));
    this._bindings.on('characteristicsDiscover', this.onCharacteristicsDiscover.bind(this));
    this._bindings.on('read', this.onRead.bind(this));
    this._bindings.on('write', this.onWrite.bind(this));
    this._bindings.on('broadcast', this.onBroadcast.bind(this));
    this._bindings.on('notify', this.onNotify.bind(this));
    this._bindings.on('descriptorsDiscover', this.onDescriptorsDiscover.bind(this));
    this._bindings.on('valueRead', this.onValueRead.bind(this));
    this._bindings.on('valueWrite', this.onValueWrite.bind(this));
    this._bindings.on('handleRead', this.onHandleRead.bind(this));
    this._bindings.on('handleWrite', this.onHandleWrite.bind(this));
    this._bindings.on('handleNotify', this.onHandleNotify.bind(this));

    this.on('warning', message => {
      if (this.listeners('warning').length === 1) {
        console.warn('noble: ' + message);
      }
    });
  }

  init() {
    if (!this.initialized) {
      this._bindings.init();
      this.initialized = true;
    }
  }

  get state() {
    return this._state;
  }

  onStateChange(state) {
    debug('stateChange ' + state);

    this._state = state;

    this.emit('stateChange', state);
  }

  onAddressChange(address) {
    debug('addressChange ' + address);

    this.address = address;
  }

  startScanning(serviceUuids, allowDuplicates) {
    return new Promise((resolve, reject) => {
      if (this._state !== 'poweredOn') {
        reject(new Error('Could not start scanning, state is ' + this._state  + ' (not poweredOn)'));
      } else {
        this.once('scanStart', (filterDuplicates) => {
          resolve(filterDuplicates);
        });

        this._discoveredPeripheralUUids = [];
        this._allowDuplicates = allowDuplicates;

        this._bindings.startScanning(serviceUuids, allowDuplicates);
      }
    })
  }

  onScanStart(filterDuplicates) {
    debug('scanStart');
    this.emit('scanStart', filterDuplicates);
  }

  stopScanning() {
    return new Promise((resolve, reject) => {
      this.once('scanStop', () => {
        resolve();
      });
      this._bindings.stopScanning();
    });
  }

  onScanStop() {
    debug('scanStop');
    this.emit('scanStop');
  }

  onDiscover(uuid, address, addressType, connectable, advertisement, rssi) {
    let peripheral = this._peripherals[uuid];

    if (!peripheral) {
      peripheral = new Peripheral(
        this,
        uuid,
        address,
        addressType,
        connectable,
        advertisement,
        rssi,
      );

      this._peripherals[uuid] = peripheral;
      this._services[uuid] = {};
      this._characteristics[uuid] = {};
      this._descriptors[uuid] = {};
    } else {
      // "or" the advertisment data with existing
      const keys = Object.keys(advertisement);
      for (const key of keys) {
        if (advertisement[key]) {
          peripheral.advertisement[key] = advertisement[key];
        }
      }

      peripheral.rssi = rssi;
    }

    const previouslyDiscoverd = this._discoveredPeripheralUUids.indexOf(uuid) !== -1;

    if (!previouslyDiscoverd) {
      this._discoveredPeripheralUUids.push(uuid);
    }

    if (this._allowDuplicates || !previouslyDiscoverd) {
      this.emit('discover', peripheral);
    }
  }

  connect(peripheralUuid) {
    return this._bindings.connect(peripheralUuid);
  }

  // onConnect(peripheralUuid, error) {
  //   const peripheral = this._peripherals[peripheralUuid];
  //
  //   if (peripheral) {
  //     peripheral.state = error ? 'error' : 'connected';
  //     peripheral.emit('connect', error);
  //   } else {
  //     this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' connected!');
  //   }
  // }

  disconnect(peripheralUuid) {
    this._bindings.disconnect(peripheralUuid);
  }

  onDisconnect(peripheralUuid) {
    const peripheral = this._peripherals[peripheralUuid];

    if (peripheral) {
      peripheral.state = 'disconnected';
      peripheral.emit('disconnect');
    } else {
      this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' disconnected!');
    }
  }

  updateRssi(peripheralUuid) {
    this._bindings.updateRssi(peripheralUuid);
  }

  onRssiUpdate(peripheralUuid, rssi) {
    const peripheral = this._peripherals[peripheralUuid];

    if (peripheral) {
      peripheral.rssi = rssi;

      peripheral.emit('rssiUpdate', rssi);
    } else {
      this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' RSSI update!');
    }
  }

  discoverServices(peripheralUuid, uuids) {
    this._bindings.discoverServices(peripheralUuid, uuids);
  }

  onServicesDiscover(peripheralUuid, serviceUuids) {
    const peripheral = this._peripherals[peripheralUuid];

    if (peripheral) {
      const services = [];

      for (const serviceUuid of serviceUuids) {
        const service = new Service(this, peripheralUuid, serviceUuid);

        this._services[peripheralUuid][serviceUuid] = service;
        this._characteristics[peripheralUuid][serviceUuid] = {};
        this._descriptors[peripheralUuid][serviceUuid] = {};

        services.push(service);
      }

      peripheral.services = services;

      peripheral.emit('servicesDiscover', services);
    } else {
      this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' services discover!');
    }
  }

  discoverIncludedServices(peripheralUuid, serviceUuid, serviceUuids) {
    this._bindings.discoverIncludedServices(peripheralUuid, serviceUuid, serviceUuids);
  }

  onIncludedServicesDiscover(peripheralUuid, serviceUuid, includedServiceUuids) {
    const service = this._services[peripheralUuid][serviceUuid];

    if (service) {
      service.includedServiceUuids = includedServiceUuids;

      service.emit('includedServicesDiscover', includedServiceUuids);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          peripheralUuid +
          ', ' +
          serviceUuid +
          ' included services discover!',
      );
    }
  }

  discoverCharacteristics(peripheralUuid, serviceUuid, characteristicUuids) {
    this._bindings.discoverCharacteristics(peripheralUuid, serviceUuid, characteristicUuids);
  }

  onCharacteristicsDiscover(peripheralUuid, serviceUuid, characteristics) {
    const service = this._services[peripheralUuid][serviceUuid];

    if (service) {
      const characteristics_ = [];

      for (let i = 0; i < characteristics.length; i++) {
        const characteristicUuid = characteristics[i].uuid;

        const characteristic = new Characteristic(
          this,
          peripheralUuid,
          serviceUuid,
          characteristicUuid,
          characteristics[i].properties,
        );

        this._characteristics[peripheralUuid][serviceUuid][characteristicUuid] = characteristic;
        this._descriptors[peripheralUuid][serviceUuid][characteristicUuid] = {};

        characteristics_.push(characteristic);
      }

      service.characteristics = characteristics_;

      service.emit('characteristicsDiscover', characteristics_);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ' characteristics discover!',
      );
    }
  }

  read(peripheralUuid, serviceUuid, characteristicUuid) {
    this._bindings.read(peripheralUuid, serviceUuid, characteristicUuid);
  }

  onRead(peripheralUuid, serviceUuid, characteristicUuid, data, isNotification) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('data', data, isNotification);

      characteristic.emit('read', data, isNotification); // for backwards compatbility
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          peripheralUuid +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ' read!',
      );
    }
  }

  write(peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse) {
    this._bindings.write(peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse);
  }

  onWrite(peripheralUuid, serviceUuid, characteristicUuid) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('write');
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          peripheralUuid +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ' write!',
      );
    }
  }

  broadcast(peripheralUuid, serviceUuid, characteristicUuid, broadcast) {
    this._bindings.broadcast(peripheralUuid, serviceUuid, characteristicUuid, broadcast);
  }

  onBroadcast(peripheralUuid, serviceUuid, characteristicUuid, state) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('broadcast', state);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          peripheralUuid +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ' broadcast!',
      );
    }
  }

  notify(peripheralUuid, serviceUuid, characteristicUuid, notify) {
    this._bindings.notify(peripheralUuid, serviceUuid, characteristicUuid, notify);
  }

  onNotify(peripheralUuid, serviceUuid, characteristicUuid, state) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('notify', state);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          peripheralUuid +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ' notify!',
      );
    }
  }

  discoverDescriptors(peripheralUuid, serviceUuid, characteristicUuid) {
    this._bindings.discoverDescriptors(peripheralUuid, serviceUuid, characteristicUuid);
  }

  onDescriptorsDiscover(peripheralUuid, serviceUuid, characteristicUuid, descriptors) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      const descriptors_ = [];

      for (let i = 0; i < descriptors.length; i++) {
        const descriptorUuid = descriptors[i];

        const descriptor = new Descriptor(
          this,
          peripheralUuid,
          serviceUuid,
          characteristicUuid,
          descriptorUuid,
        );

        this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][
          descriptorUuid
        ] = descriptor;

        descriptors_.push(descriptor);
      }

      characteristic.descriptors = descriptors_;

      characteristic.emit('descriptorsDiscover', descriptors_);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          peripheralUuid +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ' descriptors discover!',
      );
    }
  }

  readValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
    this._bindings.readValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid);
  }

  onValueRead(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
    const descriptor = this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][
      descriptorUuid
    ];

    if (descriptor) {
      descriptor.emit('valueRead', data);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          peripheralUuid +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ', ' +
          descriptorUuid +
          ' value read!',
      );
    }
  }

  writeValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
    this._bindings.writeValue(
      peripheralUuid,
      serviceUuid,
      characteristicUuid,
      descriptorUuid,
      data,
    );
  }

  onValueWrite(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
    const descriptor = this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][
      descriptorUuid
    ];

    if (descriptor) {
      descriptor.emit('valueWrite');
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          peripheralUuid +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ', ' +
          descriptorUuid +
          ' value write!',
      );
    }
  }

  readHandle(peripheralUuid, handle) {
    this._bindings.readHandle(peripheralUuid, handle);
  }

  onHandleRead(peripheralUuid, handle, data) {
    const peripheral = this._peripherals[peripheralUuid];

    if (peripheral) {
      peripheral.emit('handleRead' + handle, data);
    } else {
      this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' handle read!');
    }
  }

  writeHandle(peripheralUuid, handle, data, withoutResponse) {
    this._bindings.writeHandle(peripheralUuid, handle, data, withoutResponse);
  }

  onHandleWrite(peripheralUuid, handle) {
    const peripheral = this._peripherals[peripheralUuid];

    if (peripheral) {
      peripheral.emit('handleWrite' + handle);
    } else {
      this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' handle write!');
    }
  }

  onHandleNotify(peripheralUuid, handle, data) {
    const peripheral = this._peripherals[peripheralUuid];

    if (peripheral) {
      peripheral.emit('handleNotify', handle, data);
    } else {
      this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' handle notify!');
    }
  }
}
module.exports = Noble;
