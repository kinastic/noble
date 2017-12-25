const Noble = require('./lib/noble');
const NobleBindings = require('./lib/resolve-bindings')();

const NobleFactory = (deviceId = 0, userMode = false) => {
  const bindings = new NobleBindings(deviceId, userMode);
  return new Noble(bindings);
};

module.exports = NobleFactory;
