"use strict";

var ReplicatorBase = require("./ReplicatorBase.js");
var Data = require("lapis-data");


module.exports = ReplicatorBase.clone({
    id: "CouchReplicator",
});


module.exports.define("instantiate", function (id, server_url) {
    if (this.instance) {
        this.throwError("can't instantiate on an instance");
    }
    return this.clone({
        id: id,
        local_store: Data.Store.StoreIndexedDB.clone({
            id: id + "StoreIdxDB",
            db_id: id.toLowerCase(),
            instance: true,
            store_id: "main",
            version: 3,
        }),
        remote_store: Data.Store.StoreCouch.clone({
            id: id + "StoreCouch",
            db_id: id.toLowerCase(),
            instance: true,
            server_url: server_url,
        }),
    });
});


module.exports.defbind("startLocalStore", "start", function () {
    return this.local_store.start();
});


module.exports.defbind("startRemoteStore", "start", function () {
    return this.remote_store.start();
});


// use changelog?
module.exports.override("getServerDocChanges", function () {
    var that = this;
    this.debug("beginning getServerDocChanges()");
    return this.remote_store.getChanges(this.replication_data.start_point)
    // server_changed_docs is a map object keyed on uuid, each value being rev string
        .then(function (server_changed_docs) {
            var i;
            var server_props_i;

            that.replication_data.end_point = server_changed_docs.last_seq;
            that.replication_data.server_changes = server_changed_docs.results.length;

            for (i = 0; i < server_changed_docs.results.length; i += 1) {
                server_props_i = server_changed_docs.results[i];
                server_changed_docs[server_props_i.id] = server_props_i.changes[0].rev;
                that.debug("doc: " + server_props_i.id + " = " + server_props_i.changes[0].rev);
            }
            delete server_changed_docs.results;
            delete server_changed_docs.last_seq;
            return server_changed_docs;
        });
});
