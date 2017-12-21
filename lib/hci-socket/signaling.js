const debug = require('debug')('signaling');

const events = require('events');
const os = require('os');
const util = require('util');
const Rx = require('rxjs/Rx');

const CONNECTION_PARAMETER_UPDATE_REQUEST  = 0x12;
const CONNECTION_PARAMETER_UPDATE_RESPONSE = 0x13;

const SIGNALING_CID = 0x0005;

class Signaling {
  constructor(handle, aclStream, userMode = false) {
    this.source = new Rx.Subject();
    this._handle = handle;
    this._aclStream = aclStream;
    this._userMode = userMode;
    this.aclSubscription = this._aclStream.source.subscribe(({ event, payload }) => {
      this.handleAclEvent(event, payload);
    });
  }

  handleAclEvent(event, payload) {
    if (event === 'data') {
      this.onAclStreamData(payload);
    } else if (event === 'end') {
      this.onAclStreamEnd(payload);
    }
  }

  onAclStreamData({ cid, data }) {
    if (cid !== SIGNALING_CID) {
      return;
    }

    const code = data.readUInt8(0);

    if (code === CONNECTION_PARAMETER_UPDATE_REQUEST) {
      const identifier = data.readUInt8(1);
      const length = data.readUInt16LE(2);
      const signalingData = data.slice(4);

      debug('onAclStreamData: ' + data.toString('hex'));
      debug('\tcode = ' + code);
      debug('\tidentifier = ' + identifier);
      debug('\tlength = ' + length);

      this.processConnectionParameterUpdateRequest(identifier, signalingData);
    }
  }

  onAclStreamEnd() {
    this.aclSubscription.unsubscribe();
  }

  processConnectionParameterUpdateRequest(identifier, data) {
    const minInterval = data.readUInt16LE(0) * 1.25;
    const maxInterval = data.readUInt16LE(2) * 1.25;
    const latency = data.readUInt16LE(4);
    const supervisionTimeout = data.readUInt16LE(6) * 10;

    debug('\t\tmin interval = ', minInterval);
    debug('\t\tmax interval = ', maxInterval);
    debug('\t\tlatency = ', latency);
    debug('\t\tsupervision timeout = ', supervisionTimeout);

    if (os.platform() !== 'linux' || this._userMode) {
      const response = new Buffer(6);

      response.writeUInt8(CONNECTION_PARAMETER_UPDATE_RESPONSE, 0); // code
      response.writeUInt8(identifier, 1); // identifier
      response.writeUInt16LE(2, 2); // length
      response.writeUInt16LE(0, 4);

      this._aclStream.write(SIGNALING_CID, response);

      // TODO test
      this.source.next({ event: 'connectionParameterUpdateRequest', payload: { handle: this._handle, minInterval, maxInterval, latency, supervisionTimeout } });
      // this.emit('connectionParameterUpdateRequest', this._handle, minInterval, maxInterval, latency, supervisionTimeout);
    }
  }
}

module.exports = Signaling;
