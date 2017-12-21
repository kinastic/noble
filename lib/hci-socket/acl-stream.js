const debug = require('debug')('acl-att-stream');

const Rx = require('rxjs/Rx');

const Smp = require('./smp');

class AclStream {
  constructor(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress) {
    this.source = new Rx.Subject();
    this._hci = hci;
    this._handle = handle;

    this._smp = new Smp(this, localAddressType, localAddress, remoteAddressType, remoteAddress);
    this.smpSubscription = this._smp.source.subscribe(({ event, payload }) => {
      this.handleSmpEvent(event, payload);
    })
  }

  handleSmpEvent(event, payload) {
    switch (event) {
      case 'stk': this.onSmpStk(payload);
        break;
      case 'fail': this.onSmpFail(payload);
        break;
      case 'end': this.onSmpEnd(payload);
        break;
    }
  }

  encrypt() {
    this._smp.sendPairingRequest();
  }

  write(cid, data) {
    this._hci.writeAclDataPkt(this._handle, cid, data);
  }

  push(cid, data) {
    if (data) {
      // TODO test
      this.source.next({ event: 'data', payload: { cid, data } });
      // this.emit('data', cid, data);
    } else {
      // TODO test
      this.source.next({ event: 'end' });
      // this.emit('end');
    }
  }

  pushEncrypt(encrypt) {
    // TODO test
    this.source.next({ event: 'encrypt', payload: { encrypt } });
    // this.emit('encrypt', encrypt);
  }

  onSmpStk({ stk }) {
    const random = new Buffer('0000000000000000', 'hex');
    const diversifier = new Buffer('0000', 'hex');

    this._hci.startLeEncryption(this._handle, random, diversifier, stk);
  }

  onSmpFail() {
    // TODO test
    this.source.next({ event: 'encryptFail' });
    // this.emit('encryptFail');
  }

  onSmpEnd() {
    this.smpSubscription.dispose();
    // this._smp.removeListener('stk', this.onSmpStkBinded);
    // this._smp.removeListener('fail', this.onSmpFailBinded);
    // this._smp.removeListener('end', this.onSmpEndBinded);
  }
}

module.exports = AclStream;
