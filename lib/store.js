import persist from "./persist.js";

export default {
  addresses: {},
  challenge: {},
  change: [],
  exceptions: [],
  issuances: {},
  logins: {},
  seen: [],
  sessions: {},
  sockets: {},
  unaccounted: [],
  networks: [],
  convert: persist("data/conversions.json"),
  rates: {},
  fx: {},
  assets: {},
  bcAddressIndex: 0,
  lqAddressIndex: 0,
  last: {},
  payments: []
};