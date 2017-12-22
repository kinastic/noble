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

  onDiscover(address, addressType, connectable, advertisement, rssi) {
    let peripheral = this._peripherals[address];

    if (!peripheral) {
      peripheral = new Peripheral(
        this,
        address,
        addressType,
        connectable,
        advertisement,
        rssi,
      );

      this._peripherals[address] = peripheral;
      this._services[address] = {};
      this._characteristics[address] = {};
      this._descriptors[address] = {};
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

    const previouslyDiscoverd = this._discoveredPeripheralUUids.indexOf(address) !== -1;

    if (!previouslyDiscoverd) {
      this._discoveredPeripheralUUids.push(address);
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

  onServicesDiscover(address, serviceUuids) {
    const peripheral = this._peripherals[address];

    if (peripheral) {
      const services = [];

      for (const serviceUuid of serviceUuids) {
        const service = new Service(this, address, serviceUuid);

        this._services[address][serviceUuid] = service;
        this._characteristics[address][serviceUuid] = {};
        this._descriptors[address][serviceUuid] = {};

        services.push(service);
      }

      peripheral.services = services;

      peripheral.emit('servicesDiscover', services);
    } else {
      this.emit('warning', 'unknown peripheral ' + address + ' services discover!');
    }
  }

  discoverIncludedServices(address, serviceUuid, serviceUuids) {
    this._bindings.discoverIncludedServices(address, serviceUuid, serviceUuids);
  }

  onIncludedServicesDiscover(address, serviceUuid, includedServiceUuids) {
    const service = this._services[address][serviceUuid];

    if (service) {
      service.includedServiceUuids = includedServiceUuids;

      service.emit('includedServicesDiscover', includedServiceUuids);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          address +
          ', ' +
          serviceUuid +
          ' included services discover!',
      );
    }
  }

  discoverCharacteristics(address, serviceUuid, characteristicUuids) {
    this._bindings.discoverCharacteristics(address, serviceUuid, characteristicUuids);
  }

  onCharacteristicsDiscover(address, serviceUuid, characteristics) {
    const service = this._services[address][serviceUuid];

    if (service) {
      const characteristics_ = [];

      for (let i = 0; i < characteristics.length; i++) {
        const characteristicUuid = characteristics[i].uuid;

        const characteristic = new Characteristic(
          this,
          address,
          serviceUuid,
          characteristicUuid,
          characteristics[i].properties,
        );

        this._characteristics[address][serviceUuid][characteristicUuid] = characteristic;
        this._descriptors[address][serviceUuid][characteristicUuid] = {};

        characteristics_.push(characteristic);
      }

      service.characteristics = characteristics_;

      service.emit('characteristicsDiscover', characteristics_);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' + address + ', ' + serviceUuid + ' characteristics discover!',
      );
    }
  }

  read(peripheralUuid, serviceUuid, characteristicUuid) {
    this._bindings.read(peripheralUuid, serviceUuid, characteristicUuid);
  }

  onRead(address, serviceUuid, characteristicUuid, data, isNotification) {
    const characteristic = this._characteristics[address][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('data', data, isNotification);

      characteristic.emit('read', data, isNotification); // for backwards compatbility
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          address +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ' read!',
      );
    }
  }

  write(address, serviceUuid, characteristicUuid, data, withoutResponse) {
    this._bindings.write(address, serviceUuid, characteristicUuid, data, withoutResponse);
  }

  onWrite(address, serviceUuid, characteristicUuid) {
    const characteristic = this._characteristics[address][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('write');
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          address +
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

  notify(address, serviceUuid, characteristicUuid, notify) {
    this._bindings.notify(address, serviceUuid, characteristicUuid, notify);
  }

  onNotify(address, serviceUuid, characteristicUuid, state) {
    const characteristic = this._characteristics[address][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('notify', state);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          address +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ' notify!',
      );
    }
  }

  discoverDescriptors(address, serviceUuid, characteristicUuid) {
    this._bindings.discoverDescriptors(address, serviceUuid, characteristicUuid);
  }

  onDescriptorsDiscover(address, serviceUuid, characteristicUuid, descriptors) {
    const characteristic = this._characteristics[address][serviceUuid][characteristicUuid];

    if (characteristic) {
      const descriptors_ = [];

      for (let i = 0; i < descriptors.length; i++) {
        const descriptorUuid = descriptors[i];

        const descriptor = new Descriptor(
          this,
          address,
          serviceUuid,
          characteristicUuid,
          descriptorUuid,
        );

        this._descriptors[address][serviceUuid][characteristicUuid][
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
          address +
          ', ' +
          serviceUuid +
          ', ' +
          characteristicUuid +
          ' descriptors discover!',
      );
    }
  }

  readValue(address, serviceUuid, characteristicUuid, descriptorUuid) {
    this._bindings.readValue(address, serviceUuid, characteristicUuid, descriptorUuid);
  }

  onValueRead(address, serviceUuid, characteristicUuid, descriptorUuid, data) {
    const descriptor = this._descriptors[address][serviceUuid][characteristicUuid][
      descriptorUuid
    ];

    if (descriptor) {
      descriptor.emit('valueRead', data);
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          address +
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

  writeValue(address, serviceUuid, characteristicUuid, descriptorUuid, data) {
    this._bindings.writeValue(
      address,
      serviceUuid,
      characteristicUuid,
      descriptorUuid,
      data,
    );
  }

  onValueWrite(address, serviceUuid, characteristicUuid, descriptorUuid) {
    const descriptor = this._descriptors[address][serviceUuid][characteristicUuid][
      descriptorUuid
    ];

    if (descriptor) {
      descriptor.emit('valueWrite');
    } else {
      this.emit(
        'warning',
        'unknown peripheral ' +
          address +
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

  readHandle(address, handle) {
    this._bindings.readHandle(address, handle);
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
