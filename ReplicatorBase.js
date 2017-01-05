"use strict";

var Core = require("lapis-core");
var Under = require("underscore");

/*
 * General Design:
 * 1. Get a structure representing changes on the server - getServerAllDocSummary() returning
 *      server_props_all
 * 2. replicateLocalDocs() loops over all local documents,
 * 3. calling replicateSingleDoc() on each, which:
 * 4. decides whether a local change needs to be pushed to the server, vice versa, or no action
 *      required
 *
 * doc_obj.local_change = true      I have a local change to PUT, server believed to be in sync
 * doc_obj.local_delete = true      I have a local DELETE to send, server found to be in sync
 * doc_obj.conflict_payload = {...} I have a local change to PUT, server believed to be out of sync
 */

module.exports = Core.Base.clone({
    id: "ReplicatorBase",
    local_store: null,             // local Store object
    remote_store: null,             // remote Store object
    replication_interval: 1000 * 60,
    replication_continue: true,
    prop_id_rev: "_rev",
});


module.exports.register("start");
module.exports.register("replicate");


// ----------------------------------------------------------------------- API: General Replication

module.exports.define("start", function () {
    var that = this;
    if (!this.local_store) {
        this.throwError("no local_store defined");
    }
    if (!this.remote_store) {
        this.throwError("no remote_store defined");
    }
    return this.happenAsync("start", this.getNullPromise())
        .then(function () {
            that.info("replicate() calling loop");
            that.replicationLoop();         // NOT a promise!
        });
});


module.exports.define("replicate", function () {
    var that = this;
    this.replication_data = {
        started_at: (new Date()).toISOString(),
        start_point: null,
        end_point: null,
//        found_local_creates: 0,
        found_local_updates: 0,
        found_local_deletes: 0,
        found_remote_creates: 0,
        found_remote_updates: 0,
        found_remote_deletes: 0,
        found_conflicts: 0,
        local_updates_made: 0,
        remote_updates_made: 0,
        remote_deletes_made: 0,
    };
    this.info("beginning replicate() at " + this.replication_data.started_at);
    this.setStatus("replicating", "getting changes from server");

    return this.getLastReplicationPoint()
        .then(function () {
            return that.getServerDocChanges();
        })
        .then(function (server_changed_docs) {
            that.debug("start() typeof server_changed_docs: " + typeof server_changed_docs);
            that.setStatus("replicating", "cycling through local docs");
            return that.replicateDocs(server_changed_docs);
        })
        .then(function () {
            that.replication_data.ended_at = (new Date()).toISOString();
            return that.setThisReplicationPoint();
        })
        .then(function () {
            that.setStatus("paused");
        })
        .then(null, /* catch */ function (reason) {
            that.error("replicate() failed because: " + reason);
            that.setStatus("terminating");
            that.replication_continue = false;
        });
});


// ---------------------------------------------------------------------------- API: Docs


module.exports.define("saveDoc", function (uuid, payload, conflict_resolved) {
    var that = this;
    return this.local_store.get(uuid)
        .then(null, function () {           // assume doc not found
            return { uuid: uuid, };
        })
        .then(function (doc_obj) {
            if (doc_obj.conflict_payload && !conflict_resolved) {
                that.throwError("document cannot be saved until conflict is resolved");
            }
            if (Under.isEqual(doc_obj.payload, payload)) {          // no change to save
                return that.getNullPromise(false);
            }
            doc_obj.local_change = true;        // test to see if payload has changed
            doc_obj.payload = payload;
            delete doc_obj.conflict_payload;
            return that.local_store.save(doc_obj);
        });
});


module.exports.define("getDoc", function (uuid) {
    return this.local_store.get(uuid)
        .then(function (doc_obj) {
            return doc_obj.payload;
        });
});


module.exports.define("deleteDoc", function (uuid, conflict_resolved) {
    var that = this;
    return this.local_store.get(uuid)
        .then(null, function () {           // assume doc not found
            return { uuid: uuid, };
        })
        .then(function (doc_obj) {
            if (doc_obj.conflict_payload && !conflict_resolved) {
                that.throwError("document cannot be saved until conflict is resolved");
            }
            if (doc_obj.local_delete) {         // already flagged for deletion
                return that.getNullPromise(false);
            }
            doc_obj.local_delete = true;        // test to see if payload has changed
            delete doc_obj.conflict_payload;
            return that.local_store.save(doc_obj);
        });
});


module.exports.define("getServerDocChanges", function () {         // to be overridden
    return undefined;
});


module.exports.define("replicationLoop", function () {
    var that = this;
    this.info("beginning replicationLoop()");
    setTimeout(function () {
        if (!that.replication_continue) {
            that.info("Replicator terminating");
            return;
        }
        that.replicate();
    }, this.replication_interval);
});


module.exports.define("replicateDocs", function (server_changed_docs) {
    var that = this;
    this.debug("beginning replicateDocs()");
    return this.local_store.getAll()
        .then(function (results) {
            return that.loopOverLocalDocs(results, server_changed_docs);
        })
        .then(function () {
            that.info("Docs on the server not already local: " + Object.keys(server_changed_docs));
            return that.loopOverRemoteDocs(server_changed_docs);
        });
});


module.exports.define("loopOverLocalDocs", function (results, server_changed_docs) {
    var that = this;
    var result = results.pop();

    if (!result) {
        return null;
    }
    this.debug("loopOverLocalDocs() " + result.uuid);
    return this.replicateLocalSingleDoc(result, server_changed_docs[result.uuid])
        .then(function () {
            delete server_changed_docs[result.uuid];
            return that.loopOverLocalDocs(results, server_changed_docs);
        });
});


module.exports.define("replicateLocalSingleDoc", function (doc_obj, server_changed_doc_rev) {
    var promise;
    this.info("beginning replicateLocalSingleDoc() on: " + doc_obj.uuid +
        ", local_change: " + doc_obj.local_change +
        ", server_changed_doc_rev: " + server_changed_doc_rev +
        ", doc_obj._rev: " + doc_obj[this.prop_id_rev]);

    if (doc_obj.uuid === "root") {
        this.trace("ignore root doc in replication");
    } else if (doc_obj.local_delete) {
        promise = this.foundLocalDelete(doc_obj);
    } else if (doc_obj.conflict_payload || (doc_obj.local_change && server_changed_doc_rev
            && server_changed_doc_rev !== doc_obj[this.prop_id_rev])) {
        promise = this.foundConflict(doc_obj);
    } else if (server_changed_doc_rev && server_changed_doc_rev !== doc_obj[this.prop_id_rev]) {
        promise = this.foundRemoteUpdate(doc_obj);
    } else if (doc_obj.local_change) {
        promise = this.foundLocalUpdate(doc_obj);
    }
    if (!promise) {
        promise = this.getNullPromise();
    }
    return promise;
});

module.exports.define("foundLocalDelete", function (doc_obj) {
    var that = this;
    this.debug("foundLocalDelete(): " + JSON.stringify(doc_obj));
    this.replication_data.found_local_deletes += 1;
    return this.remote_store.delete(doc_obj.uuid, doc_obj[this.prop_id_rev])
        .then(function (data) {
            that.replication_data.remote_deletes_made += 1;
            that.debug("deleteFromServer() okay");
            return that.local_store.delete(doc_obj.uuid);
        });
});


module.exports.define("foundConflict", function (doc_obj) {
    this.info("markAsConflict(): " + JSON.stringify(doc_obj));
    doc_obj.conflict_payload = doc_obj.payload;
    this.replication_data.found_conflicts += 1;
    return this.pullFromServer(doc_obj);
});


module.exports.define("foundRemoteUpdate", function (doc_obj) {
    this.debug("foundRemoteUpdate(): " + JSON.stringify(doc_obj));
    this.replication_data.found_remote_updates += 1;
    return this.pullFromServer(doc_obj);
});


module.exports.define("foundLocalUpdate", function (doc_obj) {
    this.debug("foundLocalUpdate(): " + JSON.stringify(doc_obj));
    this.replication_data.found_local_updates += 1;
    return this.pushToServer(doc_obj);
});


module.exports.define("loopOverRemoteDocs", function (server_changed_docs) {
    var that = this;
    var uuid = Object.keys(server_changed_docs)[0];

    if (uuid) {
        this.replication_data.found_remote_creates += 1;
        delete server_changed_docs[uuid];
        return this.pullFromServer({ uuid: uuid, })
            .then(function () {
                return that.loopOverRemoteDocs(server_changed_docs);
            });
    }
    return this.getNullPromise();
});


module.exports.define("pushToServer", function (doc_obj) {
    var that = this;
    var remote_doc;

    this.info("beginning pushToServer(): " + doc_obj.uuid);
    remote_doc = Under.extend(Under.pick(doc_obj, "uuid", this.prop_id_rev), doc_obj.payload);
    this.debug("sending object: " + JSON.stringify(remote_doc));
    return this.remote_store.save(remote_doc)
        .then(null, /* catch */ function (reason) {
            // if (reason === "409") {            // conflict
            //     return that.markAsConflict(doc_obj);
            // }
            that.throwError(reason);            // conflict should have been dealt with already
        })
        .then(function (data) {
// {"ok":true,"id":"cf454fa3-daad-41c1-bed3-2df58a70eec5",
//  "rev":"3-6fe8a81ac68a0f5f87644f1ed2898554"}
            if (!data.ok) {
                that.throwError(JSON.stringify(data));
            }
            that.debug("pushToServer() okay: new rev: " + data.rev);
            that.replication_data.remote_updates_made += 1;
            doc_obj[that.prop_id_rev] = data.rev;
            delete doc_obj.local_change;
            return that.local_store.save(doc_obj);
        });
});


module.exports.define("pullFromServer", function (doc_obj) {
    var that = this;
    this.info("beginning pullFromServer(): " + doc_obj.uuid);
    if (!doc_obj.uuid) {
        this.throwError("doc_obj has no uuid property");
    }
    return this.remote_store.get(doc_obj.uuid)
        .then(function (data) {
            doc_obj[that.prop_id_rev] = data[that.prop_id_rev];
            doc_obj.payload = Under.omit(data, ["uuid", "_id", that.prop_id_rev,
            ]);
            that.replication_data.local_updates_made += 1;
            return that.local_store.save(doc_obj);
        });
});


// This function should be used to reset the replication state of the local data, but NOT to clean
// up the doc payloads
module.exports.define("replicationReset", function () {
    var that = this;
    this.info("beginning replicationReset()");
    this.last_replication_point = null;
    return this.local_store.getAllDocs()
        .then(function (results) {
            var i;
            var doc;
            for (i = 0; i < results.length; i += 1) {
                doc = results[i];
                delete doc.repl_status;
                delete doc.local_change;
                delete doc[that.prop_id_rev];
                delete doc.conflict_payload;
                that.local_store.save(doc);
            }
        })
        .then(null, /* catch */ function (reason) {
            that.error("replicationReset() failed: " + reason);
        });
});


module.exports.define("setStatus", function (status_str, message) {
    this.info(this.id + " === " + status_str + " === " + (message || ""));
});


module.exports.define("getReplicationStatus", function (doc_obj) {
    var out = "";
    var delim = "";

    function addPiece(str) {
        out += delim + str;
        delim = ", ";
    }
    if (doc_obj.local_delete) {
        addPiece("local delete");
    }
    if (doc_obj.local_change) {
        addPiece("local change");
    }
    if (doc_obj.conflict_payload) {
        addPiece("** conflict **");
    }
    if (!out) {
        out = "up-to-date";
    }
    return out;
});


module.exports.define("getLastReplicationPoint", function () {
    var that = this;
    this.debug("beginning getLastReplicationPoint()");
    if (this.root_doc) {
        this.replication_data.start_point = this.root_doc.last_replication_point;
        return this.getNullPromise();
    }
    return this.local_store.get("root")
        .then(function (doc_obj) {
            that.root_doc = doc_obj;
            that.replication_data.start_point = that.root_doc.last_replication_point;
        })
        .then(null, /* catch */ function (reason) {
            that.warn("getLastReplicationPoint(): no root doc found: " + reason);
        });
});


module.exports.define("setThisReplicationPoint", function () {
    this.info("beginning setThisReplicationPoint()");
    this.root_doc = this.root_doc || { uuid: "root", };
    this.root_doc.last_replication_point = this.replication_data.end_point;
    this.root_doc.history = this.root_doc.history || [];
    this.root_doc.history.push(this.replication_data);
    return this.local_store.save(this.root_doc);
});


module.exports.define("resetReplicationPoint", function () {
    var that = this;
    this.info("beginning resetReplicationPoint()");
    if (!this.root_doc) {
        this.throwError("no root doc");
    }
    this.root_doc.last_replication_point = null;
    delete this.root_doc.repl_status;
    return this.local_store.save(this.root_doc)
        .then(null, /* catch */ function (reason) {
            that.error("setThisReplicationPoint() failed: " + reason);
        });
});
