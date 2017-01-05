"use strict";


console.log("starting lapis-browser/index.js");

exports.Controller = require("./Controller.js");

exports.ReplicatorBase = require("./ReplicatorBase.js");
exports.ReplicatorCouch = require("./ReplicatorCouch.js");
// exports.ReplicatorWebdav = require("./ReplicatorWebdav.js");
exports.StoreCouch = require("./StoreCouch.js");
exports.StoreIndexedDB = require("./StoreIndexedDB.js");

console.log("ending lapis-browser/index.js");
