// Los códigos de empleado NO se guardan en texto: se guarda una huella (hash).
const crypto = require('crypto');

function hashPin(pin) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return salt + ':' + hash;
}

function checkPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pin, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

module.exports = { hashPin, checkPin };
