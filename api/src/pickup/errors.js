"use strict";

class PickupError extends Error {
  constructor(status, code, options = {}) {
    super(code);
    this.name = "PickupError";
    this.status = status;
    this.code = code;
    this.quarantine = options.quarantine === true;
    this.cause = options.cause;
  }
}

function pickupError(status, code, options) {
  return new PickupError(status, code, options);
}

module.exports = { PickupError, pickupError };
