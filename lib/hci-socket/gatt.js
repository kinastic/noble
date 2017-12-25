const debug = require('debug')('att');

const events = require('events');
const util = require('util');
const Rx = require('rxjs/Rx');

const ATT_OP_ERROR                    = 0x01;
const ATT_OP_MTU_REQ                  = 0x02;
const ATT_OP_MTU_RESP                 = 0x03;
const ATT_OP_FIND_INFO_REQ            = 0x04;
const ATT_OP_FIND_INFO_RESP           = 0x05;
const ATT_OP_READ_BY_TYPE_REQ         = 0x08;
const ATT_OP_READ_BY_TYPE_RESP        = 0x09;
const ATT_OP_READ_REQ                 = 0x0a;
const ATT_OP_READ_RESP                = 0x0b;
const ATT_OP_READ_BLOB_REQ            = 0x0c;
const ATT_OP_READ_BLOB_RESP           = 0x0d;
const ATT_OP_READ_BY_GROUP_REQ        = 0x10;
const ATT_OP_READ_BY_GROUP_RESP       = 0x11;
const ATT_OP_WRITE_REQ                = 0x12;
const ATT_OP_WRITE_RESP               = 0x13;
const ATT_OP_PREPARE_WRITE_REQ        = 0x16;
const ATT_OP_PREPARE_WRITE_RESP       = 0x17;
const ATT_OP_EXECUTE_WRITE_REQ        = 0x18;
const ATT_OP_EXECUTE_WRITE_RESP       = 0x19;
const ATT_OP_HANDLE_NOTIFY            = 0x1b;
const ATT_OP_HANDLE_IND               = 0x1d;
const ATT_OP_HANDLE_CNF               = 0x1e;
const ATT_OP_WRITE_CMD                = 0x52;

const ATT_ECODE_SUCCESS               = 0x00;
const ATT_ECODE_INVALID_HANDLE        = 0x01;
const ATT_ECODE_READ_NOT_PERM         = 0x02;
const ATT_ECODE_WRITE_NOT_PERM        = 0x03;
const ATT_ECODE_INVALID_PDU           = 0x04;
const ATT_ECODE_AUTHENTICATION        = 0x05;
const ATT_ECODE_REQ_NOT_SUPP          = 0x06;
const ATT_ECODE_INVALID_OFFSET        = 0x07;
const ATT_ECODE_AUTHORIZATION         = 0x08;
const ATT_ECODE_PREP_QUEUE_FULL       = 0x09;
const ATT_ECODE_ATTR_NOT_FOUND        = 0x0a;
const ATT_ECODE_ATTR_NOT_LONG         = 0x0b;
const ATT_ECODE_INSUFF_ENCR_KEY_SIZE  = 0x0c;
const ATT_ECODE_INVAL_ATTR_VALUE_LEN  = 0x0d;
const ATT_ECODE_UNLIKELY              = 0x0e;
const ATT_ECODE_INSUFF_ENC            = 0x0f;
const ATT_ECODE_UNSUPP_GRP_TYPE       = 0x10;
const ATT_ECODE_INSUFF_RESOURCES      = 0x11;

const GATT_PRIM_SVC_UUID              = 0x2800;
const GATT_INCLUDE_UUID               = 0x2802;
const GATT_CHARAC_UUID                = 0x2803;

const GATT_CLIENT_CHARAC_CFG_UUID     = 0x2902;
const GATT_SERVER_CHARAC_CFG_UUID     = 0x2903;

const ATT_CID = 0x0004;

class Gatt {
  constructor(address, aclStream) {
    this.source = new Rx.Subject();
    this._address = address;
    this._aclStream = aclStream;

    this._services = {};
    this._characteristics = {};
    this._descriptors = {};

    this._currentCommand = null;
    this._commandQueue = [];

    this._mtu = 23;
    this._security = 'low';

    this.aclSubscription = this._aclStream.source.subscribe(({ event, payload }) => {
      this.handleAclEvent(event, payload);
    });
  }

  handleAclEvent(event, payload) {
    switch (event) {
      case 'data': this.onAclStreamData(payload);
        break;
      case 'encrypt': this.onAclStreamEncrypt(payload);
        break;
      case 'encryptFail': this.onAclStreamEncryptFail(payload);
        break;
      case 'end': this.onAclStreamEnd(payload);
        break;
    }
  }

  onAclStreamData({ cid, data }) {
    if (cid !== ATT_CID) {
      return;
    }

    if (this._currentCommand && data.toString('hex') === this._currentCommand.buffer.toString('hex')) {
      debug(this._address + ': echo ... echo ... echo ...');
    } else if (data[0] % 2 === 0) {
      if (process.env.NOBLE_MULTI_ROLE) {
        debug(this._address + ': multi-role flag in use, ignoring command meant for peripheral role.');
      } else {
        const requestType = data[0];
        debug(this._address + ': replying with REQ_NOT_SUPP to 0x' + requestType.toString(16));
        this.writeAtt(this.errorResponse(requestType, 0x0000, ATT_ECODE_REQ_NOT_SUPP));
      }
    } else if (data[0] === ATT_OP_HANDLE_NOTIFY || data[0] === ATT_OP_HANDLE_IND) {
      const valueHandle = data.readUInt16LE(1);
      const valueData = data.slice(3);

      // TODO tet
      this.source.next({ event: 'handleNotify', payload: { address: this._address, valueHandle, valueData } });
      // this.emit('handleNotify', this._address, valueHandle, valueData);

      if (data[0] === ATT_OP_HANDLE_IND) {
        this._queueCommand(this.handleConfirmation(), null, () => {
          // TODO test
          // not used anywhere
          this.source.next({ event: 'handleConfirmation', payload: { address: this._address, valueHandle, valueData } });
          // this.emit('handleConfirmation', this._address, valueHandle);
        });
      }

      const serviceUuids = Object.keys(this._services);
      for (const serviceUuid of serviceUuids) {
        const characteristicUuids = Object.keys(this._characteristics[serviceUuid]);
        for (const characteristicUuid of characteristicUuids) {
          if (this._characteristics[serviceUuid][characteristicUuid].valueHandle === valueHandle) {
            // TODO test
            this.source.next({ event: 'notification', payload: { address: this._address, serviceUuid, characteristicUuid, valueData } });
            // this.emit('notification', this._address, serviceUuid, characteristicUuid, valueData);
          }
        }
      }
    } else if (!this._currentCommand) {
      debug(this._address + ': uh oh, no current command');
    } else {
      if (data[0] === ATT_OP_ERROR &&
        (data[4] === ATT_ECODE_AUTHENTICATION || data[4] === ATT_ECODE_AUTHORIZATION || data[4] === ATT_ECODE_INSUFF_ENC) &&
        this._security !== 'medium') {

        this._aclStream.encrypt();
        return;
      }

      debug(this._address + ': read: ' + data.toString('hex'));

      this._currentCommand.callback(data);

      this._currentCommand = null;

      while(this._commandQueue.length) {
        this._currentCommand = this._commandQueue.shift();

        this.writeAtt(this._currentCommand.buffer);

        if (this._currentCommand.callback) {
          break;
        } else if (this._currentCommand.writeCallback) {
          this._currentCommand.writeCallback();

          this._currentCommand = null;
        }
      }
    }
  };

  onAclStreamEncrypt({ encrypt }) {
    if (encrypt) {
      this._security = 'medium';

      this.writeAtt(this._currentCommand.buffer);
    }
  };

  onAclStreamEncryptFail() {

  };

  onAclStreamEnd() {
    this.aclSubscription.unsubscribe();
  };

  writeAtt(data) {
    debug(this._address + ': write: ' + data.toString('hex'));

    this._aclStream.write(ATT_CID, data);
  };

  errorResponse(opcode, handle, status) {
    const buf = new Buffer(5);

    buf.writeUInt8(ATT_OP_ERROR, 0);
    buf.writeUInt8(opcode, 1);
    buf.writeUInt16LE(handle, 2);
    buf.writeUInt8(status, 4);

    return buf;
  };

  _queueCommand(buffer, callback, writeCallback) {
    this._commandQueue.push({ buffer, callback, writeCallback });

    if (this._currentCommand === null) {
      while (this._commandQueue.length) {
        this._currentCommand = this._commandQueue.shift();

        this.writeAtt(this._currentCommand.buffer);

        if (this._currentCommand.callback) {
          break;
        } else if (this._currentCommand.writeCallback) {
          this._currentCommand.writeCallback();
          this._currentCommand = null;
        }
      }
    }
  };

  mtuRequest(mtu) {
    const buf = new Buffer(3);

    buf.writeUInt8(ATT_OP_MTU_REQ, 0);
    buf.writeUInt16LE(mtu, 1);

    return buf;
  };

  readByGroupRequest(startHandle, endHandle, groupUuid) {
    const buf = new Buffer(7);

    buf.writeUInt8(ATT_OP_READ_BY_GROUP_REQ, 0);
    buf.writeUInt16LE(startHandle, 1);
    buf.writeUInt16LE(endHandle, 3);
    buf.writeUInt16LE(groupUuid, 5);

    return buf;
  };

  readByTypeRequest(startHandle, endHandle, groupUuid) {
    const buf = new Buffer(7);

    buf.writeUInt8(ATT_OP_READ_BY_TYPE_REQ, 0);
    buf.writeUInt16LE(startHandle, 1);
    buf.writeUInt16LE(endHandle, 3);
    buf.writeUInt16LE(groupUuid, 5);

    return buf;
  };

  readRequest(handle) {
    const buf = new Buffer(3);

    buf.writeUInt8(ATT_OP_READ_REQ, 0);
    buf.writeUInt16LE(handle, 1);

    return buf;
  };

  readBlobRequest(handle, offset) {
    const buf = new Buffer(5);

    buf.writeUInt8(ATT_OP_READ_BLOB_REQ, 0);
    buf.writeUInt16LE(handle, 1);
    buf.writeUInt16LE(offset, 3);

    return buf;
  };

  findInfoRequest(startHandle, endHandle) {
    const buf = new Buffer(5);

    buf.writeUInt8(ATT_OP_FIND_INFO_REQ, 0);
    buf.writeUInt16LE(startHandle, 1);
    buf.writeUInt16LE(endHandle, 3);

    return buf;
  };

  writeRequest(handle, data, withoutResponse) {
    const buf = new Buffer(3 + data.length);

    buf.writeUInt8(withoutResponse ? ATT_OP_WRITE_CMD : ATT_OP_WRITE_REQ , 0);
    buf.writeUInt16LE(handle, 1);

    for (let i = 0; i < data.length; i++) {
      buf.writeUInt8(data.readUInt8(i), i + 3);
    }

    return buf;
  };

  prepareWriteRequest(handle, offset, data) {
    const buf = new Buffer(5 + data.length);

    buf.writeUInt8(ATT_OP_PREPARE_WRITE_REQ);
    buf.writeUInt16LE(handle, 1);
    buf.writeUInt16LE(offset, 3);

    for (let i = 0; i < data.length; i++) {
      buf.writeUInt8(data.readUInt8(i), i + 5);
    }

    return buf;
  };

  executeWriteRequest(handle, cancelPreparedWrites) {
    const buf = new Buffer(2);

    buf.writeUInt8(ATT_OP_EXECUTE_WRITE_REQ);
    buf.writeUInt8(cancelPreparedWrites ? 0 : 1, 1);

    return buf;
  };

  handleConfirmation() {
    const buf = new Buffer(1);
    buf.writeUInt8(ATT_OP_HANDLE_CNF, 0);
    return buf;
  };

  exchangeMtu(mtu) {
    this._queueCommand(this.mtuRequest(mtu), (data) => {
      const opcode = data[0];

      if (opcode === ATT_OP_MTU_RESP) {
        const newMtu = data.readUInt16LE(1);

        debug(this._address + ': new MTU is ' + newMtu);

        this._mtu = newMtu;
      }

      // TODO test
      this.source.next({ event: 'mtu', payload: { address: this._address, mtu: this._mtu }});
      // this.emit('mtu', this._address, this._mtu);
    });
  };

  discoverServices(uuids) {
    const services = [];

    const callback = (data) => {
      const opcode = data[0];
      if (opcode === ATT_OP_READ_BY_GROUP_RESP) {
        const type = data[1];
        const num = (data.length - 2) / type;

        for (let i = 0; i < num; i++) {
          services.push({
            startHandle: data.readUInt16LE(2 + i * type + 0),
            endHandle: data.readUInt16LE(2 + i * type + 2),
            uuid: (type === 6) ? data.readUInt16LE(2 + i * type + 4).toString(16) : data.slice(2 + i * type + 4).slice(0, 16).toString('hex').match(/.{1,2}/g).reverse().join('')
          });
        }
      }

      if (opcode !== ATT_OP_READ_BY_GROUP_RESP || services[services.length - 1].endHandle === 0xffff) {
        const serviceUuids = [];
        for (const service of services) {
          if (uuids.length === 0 || uuids.indexOf(service.uuid) !== -1) {
            serviceUuids.push(service.uuid);
          }

          this._services[service.uuid] = service;
        }
        // TODO test
        this.source.next({ event: 'servicesDiscover', payload: { address: this._address, serviceUuids } })
        // this.emit('servicesDiscover', this._address, serviceUuids);
      } else {
        this._queueCommand(this.readByGroupRequest(services[services.length - 1].endHandle + 1, 0xffff, GATT_PRIM_SVC_UUID), callback);
      }
    };

    this._queueCommand(this.readByGroupRequest(0x0001, 0xffff, GATT_PRIM_SVC_UUID), callback);
  };

  discoverIncludedServices(serviceUuid, uuids) {
    const service = this._services[serviceUuid];
    const includedServices = [];

    const callback = (data) => {
      const opcode = data[0];
      let i = 0;

      if (opcode === ATT_OP_READ_BY_TYPE_RESP) {
        const type = data[1];
        const num = (data.length - 2) / type;

        for (i = 0; i < num; i++) {
          includedServices.push({
            endHandle: data.readUInt16LE(2 + i * type + 0),
            startHandle: data.readUInt16LE(2 + i * type + 2),
            uuid: (type === 8) ? data.readUInt16LE(2 + i * type + 6).toString(16) : data.slice(2 + i * type + 6).slice(0, 16).toString('hex').match(/.{1,2}/g).reverse().join('')
          });
        }
      }

      if (opcode !== ATT_OP_READ_BY_TYPE_RESP || includedServices[includedServices.length - 1].endHandle === service.endHandle) {
        const includedServiceUuids = [];

        for (i = 0; i < includedServices.length; i++) {
          if (uuids.length === 0 || uuids.indexOf(includedServices[i].uuid) !== -1) {
            includedServiceUuids.push(includedServices[i].uuid);
          }
        }

        // TODO test
        this.source.next({ event: 'includedServicesDiscover', payload: { address: this._address, serviceUuid: service.uuid, includedServiceUuids } });
        // this.emit('includedServicesDiscover', this._address, service.uuid, includedServiceUuids);
      } else {
        this._queueCommand(this.readByTypeRequest(includedServices[includedServices.length - 1].endHandle + 1, service.endHandle, GATT_INCLUDE_UUID), callback);
      }
    };

    this._queueCommand(this.readByTypeRequest(service.startHandle, service.endHandle, GATT_INCLUDE_UUID), callback);
  };

  discoverCharacteristics(serviceUuid, characteristicUuids) {
    const service = this._services[serviceUuid];
    const characteristics = [];

    this._characteristics[serviceUuid] = {};
    this._descriptors[serviceUuid] = this._descriptors[serviceUuid] || {};

    const callback = (data) => {
      const opcode = data[0];
      let i = 0;

      if (opcode === ATT_OP_READ_BY_TYPE_RESP) {
        const type = data[1];
        const num = (data.length - 2) / type;

        for (i = 0; i < num; i++) {
          characteristics.push({
            startHandle: data.readUInt16LE(2 + i * type + 0),
            properties: data.readUInt8(2 + i * type + 2),
            valueHandle: data.readUInt16LE(2 + i * type + 3),
            uuid: (type === 7) ? data.readUInt16LE(2 + i * type + 5).toString(16) : data.slice(2 + i * type + 5).slice(0, 16).toString('hex').match(/.{1,2}/g).reverse().join('')
          });
        }
      }

      if (opcode !== ATT_OP_READ_BY_TYPE_RESP || characteristics[characteristics.length - 1].valueHandle === service.endHandle) {

        const characteristicsDiscovered = [];
        for (i = 0; i < characteristics.length; i++) {
          const properties = characteristics[i].properties;

          const characteristic = {
            properties: [],
            uuid: characteristics[i].uuid
          };

          if (i !== 0) {
            characteristics[i - 1].endHandle = characteristics[i].startHandle - 1;
          }

          if (i === (characteristics.length - 1)) {
            characteristics[i].endHandle = service.endHandle;
          }

          this._characteristics[serviceUuid][characteristics[i].uuid] = characteristics[i];

          if (properties & 0x01) {
            characteristic.properties.push('broadcast');
          }

          if (properties & 0x02) {
            characteristic.properties.push('read');
          }

          if (properties & 0x04) {
            characteristic.properties.push('writeWithoutResponse');
          }

          if (properties & 0x08) {
            characteristic.properties.push('write');
          }

          if (properties & 0x10) {
            characteristic.properties.push('notify');
          }

          if (properties & 0x20) {
            characteristic.properties.push('indicate');
          }

          if (properties & 0x40) {
            characteristic.properties.push('authenticatedSignedWrites');
          }

          if (properties & 0x80) {
            characteristic.properties.push('extendedProperties');
          }

          if (characteristicUuids.length === 0 || characteristicUuids.indexOf(characteristic.uuid) !== -1) {
            characteristicsDiscovered.push(characteristic);
          }
        }

        // TODO test
        this.source.next({ event: 'characteristicsDiscover', payload: { address: this._address, serviceUuid, characteristics: characteristicsDiscovered } });
        // this.emit('characteristicsDiscover', this._address, serviceUuid, characteristicsDiscovered);
      } else {
        this._queueCommand(this.readByTypeRequest(characteristics[characteristics.length - 1].valueHandle + 1, service.endHandle, GATT_CHARAC_UUID), callback);
      }
    };

    this._queueCommand(this.readByTypeRequest(service.startHandle, service.endHandle, GATT_CHARAC_UUID), callback);
  };

  read(serviceUuid, characteristicUuid) {
    const characteristic = this._characteristics[serviceUuid][characteristicUuid];

    let readData = new Buffer(0);

    const callback = (data) => {
      const opcode = data[0];

      if (opcode === ATT_OP_READ_RESP || opcode === ATT_OP_READ_BLOB_RESP) {
        readData = new Buffer(readData.toString('hex') + data.slice(1).toString('hex'), 'hex');

        if (data.length === this._mtu) {
          this._queueCommand(this.readBlobRequest(characteristic.valueHandle, readData.length), callback);
        } else {
          // TODO test
          this.source.next({ event: 'read', payload: { address: this._address, serviceUuid, characteristicUuid, readData } });
          // this.emit('read', this._address, serviceUuid, characteristicUuid, readData);
        }
      } else {
        // TODO test
        this.source.next({ event: 'read', payload: { address: this._address, serviceUuid, characteristicUuid, readData } });
        // this.emit('read', this._address, serviceUuid, characteristicUuid, readData);
      }
    };

    this._queueCommand(this.readRequest(characteristic.valueHandle), callback);
  };

  write(serviceUuid, characteristicUuid, data, withoutResponse) {
    const characteristic = this._characteristics[serviceUuid][characteristicUuid];

    if (withoutResponse) {
      this._queueCommand(this.writeRequest(characteristic.valueHandle, data, true), null, () => {
        // TODO test
        this.source.next({ event: 'write', payload: { address: this._address, serviceUuid, characteristicUuid } });
        // this.emit('write', this._address, serviceUuid, characteristicUuid);
      });
    } else if (data.length + 3 > this._mtu) {
      return this.longWrite(serviceUuid, characteristicUuid, data, withoutResponse);
    } else {
      this._queueCommand(this.writeRequest(characteristic.valueHandle, data, false), (data) => {
        const opcode = data[0];

        if (opcode === ATT_OP_WRITE_RESP) {
          // TODO test
          this.source.next({ event: 'write', payload: { address: this._address, serviceUuid, characteristicUuid } });
          // this.emit('write', this._address, serviceUuid, characteristicUuid);
        }
      });
    }
  };

  /* Perform a "long write" as described Bluetooth Spec section 4.9.4 "Write Long Characteristic Values" */
  longWrite(serviceUuid, characteristicUuid, data, withoutResponse) {
    const characteristic = this._characteristics[serviceUuid][characteristicUuid];
    const limit = this._mtu - 5;

    const prepareWriteCallback = (data_chunk) => {
      return (resp) => {
        const opcode = resp[0];

        if (opcode !== ATT_OP_PREPARE_WRITE_RESP) {
          debug(this._address + ': unexpected reply opcode %d (expecting ATT_OP_PREPARE_WRITE_RESP)', opcode);
        } else {
          const expected_length = data_chunk.length + 5;

          if (resp.length !== expected_length) {
            /* the response should contain the data packet echoed back to the caller */
            debug(this._address + ': unexpected prepareWriteResponse length %d (expecting %d)', resp.length, expected_length);
          }
        }
      };
    };

    /* split into prepare-write chunks and queue them */
    let offset = 0;

    while (offset < data.length) {
      const end = offset+limit;
      const chunk = data.slice(offset, end);
      this._queueCommand(this.prepareWriteRequest(characteristic.valueHandle, offset, chunk), prepareWriteCallback(chunk));
      offset = end;
    }

    /* queue the execute command with a callback to emit the write signal when done */
    this._queueCommand(this.executeWriteRequest(characteristic.valueHandle), (resp) => {
      const opcode = resp[0];

      if (opcode === ATT_OP_EXECUTE_WRITE_RESP && !withoutResponse) {
        // TODO test
        this.source.next({ event: 'write', payload: { address: this._address, serviceUuid, characteristicUuid } });
        // this.emit('write', this._address, serviceUuid, characteristicUuid);
      }
    });
  };

  broadcast(serviceUuid, characteristicUuid, broadcast) {
    const characteristic = this._characteristics[serviceUuid][characteristicUuid];

    this._queueCommand(this.readByTypeRequest(characteristic.startHandle, characteristic.endHandle, GATT_SERVER_CHARAC_CFG_UUID), (data) => {
      const opcode = data[0];
      if (opcode === ATT_OP_READ_BY_TYPE_RESP) {
        const type = data[1];
        const handle = data.readUInt16LE(2);
        let value = data.readUInt16LE(4);

        if (broadcast) {
          value |= 0x0001;
        } else {
          value &= 0xfffe;
        }

        const valueBuffer = new Buffer(2);
        valueBuffer.writeUInt16LE(value, 0);

        this._queueCommand(this.writeRequest(handle, valueBuffer, false), (data) => {
          const opcode = data[0];

          if (opcode === ATT_OP_WRITE_RESP) {
            // TODO test
            this.source.next({ event: 'broadcast', payload: { address: this._address, serviceUuid, characteristicUuid, state: broadcast } });
            // this.emit('broadcast', this._address, serviceUuid, characteristicUuid, broadcast);
          }
        });
      }
    });
  };

  notify(serviceUuid, characteristicUuid, notify) {
    const characteristic = this._characteristics[serviceUuid][characteristicUuid];

    this._queueCommand(this.readByTypeRequest(characteristic.startHandle, characteristic.endHandle, GATT_CLIENT_CHARAC_CFG_UUID), (data) => {
      const opcode = data[0];
      if (opcode === ATT_OP_READ_BY_TYPE_RESP) {
        const type = data[1];
        const handle = data.readUInt16LE(2);
        let value = data.readUInt16LE(4);

        const useNotify = characteristic.properties & 0x10;
        const useIndicate = characteristic.properties & 0x20;

        if (notify) {
          if (useNotify) {
            value |= 0x0001;
          } else if (useIndicate) {
            value |= 0x0002;
          }
        } else {
          if (useNotify) {
            value &= 0xfffe;
          } else if (useIndicate) {
            value &= 0xfffd;
          }
        }

        const valueBuffer = new Buffer(2);
        valueBuffer.writeUInt16LE(value, 0);

        this._queueCommand(this.writeRequest(handle, valueBuffer, false), (data) => {
          const opcode = data[0];

          if (opcode === ATT_OP_WRITE_RESP) {
            // TODO test
            this.source.next({ event: 'notify', payload: { address: this._address, serviceUuid, characteristicUuid, state: notify } });
            // this.emit('notify', this._address, serviceUuid, characteristicUuid, notify);
          }
        });
      }
    });
  };

  discoverDescriptors(serviceUuid, characteristicUuid) {
    const characteristic = this._characteristics[serviceUuid][characteristicUuid];
    const descriptors = [];

    this._descriptors[serviceUuid][characteristicUuid] = {};

    const callback = (data) => {
      const opcode = data[0];
      let i = 0;

      if (opcode === ATT_OP_FIND_INFO_RESP) {
        const num = data[1];

        for (i = 0; i < num; i++) {
          descriptors.push({
            handle: data.readUInt16LE(2 + i * 4 + 0),
            uuid: data.readUInt16LE(2 + i * 4 + 2).toString(16)
          });
        }
      }

      if (opcode !== ATT_OP_FIND_INFO_RESP || descriptors[descriptors.length - 1].handle === characteristic.endHandle) {
        const descriptorUuids = [];
        for (i = 0; i < descriptors.length; i++) {
          descriptorUuids.push(descriptors[i].uuid);

          this._descriptors[serviceUuid][characteristicUuid][descriptors[i].uuid] = descriptors[i];
        }

        // TODO test
        this.source.next({ event: 'descriptorsDiscover', payload: { address: this._address, serviceUuid, characteristicUuid, descriptorUuids } });
        // this.emit('descriptorsDiscover', this._address, serviceUuid, characteristicUuid, descriptorUuids);
      } else {
        this._queueCommand(this.findInfoRequest(descriptors[descriptors.length - 1].handle + 1, characteristic.endHandle), callback);
      }
    };

    this._queueCommand(this.findInfoRequest(characteristic.valueHandle + 1, characteristic.endHandle), callback);
  };

  readValue(serviceUuid, characteristicUuid, descriptorUuid) {
    const descriptor = this._descriptors[serviceUuid][characteristicUuid][descriptorUuid];

    this._queueCommand(this.readRequest(descriptor.handle), (data) => {
      const opcode = data[0];

      if (opcode === ATT_OP_READ_RESP) {
        // TODO test
        this.source.next({ event: 'valueRead', payload: { address: this._address, serviceUuid, characteristicUuid, descriptorUuid, data: data.slice(1) } })
        // this.emit('valueRead', this._address, serviceUuid, characteristicUuid, descriptorUuid, data.slice(1));
      }
    });
  };

  writeValue(serviceUuid, characteristicUuid, descriptorUuid, data) {
    const descriptor = this._descriptors[serviceUuid][characteristicUuid][descriptorUuid];

    this._queueCommand(this.writeRequest(descriptor.handle, data, false), (data) => {
      const opcode = data[0];

      if (opcode === ATT_OP_WRITE_RESP) {
        // TODO test
        this.source.next({ event: 'valueWrite', payload: { address: this._address, serviceUuid, characteristicUuid, descriptorUuid } });
        // this.emit('valueWrite', this._address, serviceUuid, characteristicUuid, descriptorUuid);
      }
    });
  }

  readHandle(handle) {
    this._queueCommand(this.readRequest(handle), (data) => {
      const opcode = data[0];

      if (opcode === ATT_OP_READ_RESP) {
        // TODO test
        this.source.next({ event: 'handleRead', payload: { address: this._address, handle, data: data.slice(1) } });
        // this.emit('handleRead', this._address, handle, data.slice(1));
      }
    });
  }

  writeHandle(handle, data, withoutResponse) {
    if (withoutResponse) {
      this._queueCommand(this.writeRequest(handle, data, true), null, () => {
        // TODO test
        this.source.next({ event: 'handleWrite', payload: { address: this._address, handle } });
        // this.emit('handleWrite', this._address, handle);
      });
    } else {
      this._queueCommand(this.writeRequest(handle, data, false), (data) => {
        const opcode = data[0];

        if (opcode === ATT_OP_WRITE_RESP) {
          // TODO test
          this.source.next({ event: 'handleWrite', payload: { address: this._address, handle } });
          // this.emit('handleWrite', this._address, handle);
        }
      });
    }
  }
}

module.exports = Gatt;
