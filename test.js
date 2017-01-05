"use strict";

var Browser = require(".");
var Data = require("lapis-data");


module.exports.main = function (test) {
    var store = Browser.StoreIndexedDB.clone({
        id: "DataTest",
        db_id: "datatest",
        instance: true,
        store_id: "main",
        version: 3,
    });
    var dmgr = Data.DataManagerDocs.clone({
        id: "Test",
        store: store,
        instance: true,
    });
    var tree = Data.Entity.clone({
        id: "tree",
        title: "Tree",
        primary_key: "species",
    });


    test.expect(9);

    tree.addFields([
        {
            id: "species",
            type: Data.Text,
            label: "Species",
            mandatory: true,
        },
        {
            id: "location",
            type: Data.Text,
            label: "Location",
            mandatory: true,
        },
    ]);

    store.start()
        .then(function () {
            test.ok(true, "SETUP");                          //--------------------------------------------------------------------------
            test.ok(true, "started okay");
            return store.deleteAll();
        })
        .then(function (results) {
            test.ok(true, "cleared the client test store");
            return store.getAll();
        })
        .then(function (results) {
            test.ok(results.length === 0, "zero documents in test client store");
        })
        .then(function () {
            var record = dmgr.createNewRecord("tree");
            test.ok(record.status === "U", "created a new record");
            return record.getReadyPromise();
        })
        .then(function (record) {
            dmgr.debug("about to set values and save");
            try {
                record.populateFromObject({
                    species: "Elm",
                    location: "New Forest, Hampshire",
                });
                test.ok(dmgr.getRecordNullIfNotInCache("tree", "Elm") === record, "Elm record retrievable in DataManager cache");
                test.ok(record.isValid(), "record is valid");
                test.ok(record.status === "M", "record is modified according to status property: " + record.status);
                test.ok(record.isModified(), "record is modified according to isModified()");
                dmgr.save();
                test.ok(record.status === "S", "record is saving");
            } catch (e) {
                dmgr.report(e);
            }
            return record.getReadyPromise();
        })
        .then(function () {
            var record = dmgr.getRecordNullIfNotInCache("tree", "Elm");
            test.ok(record && (record.getUUID() === "tree:Elm"), "Elm record is in cache");

            test.ok(record.status === "U", "record is unmodified according to status property");
            test.ok(!record.isModified(), "record is unmodified according to isModified()");

            try {
                record.getField("location").set("Ashton-under-Lyme");
                test.ok(record.status === "M", "record is modified according to status property: " + record.status);
                test.ok(record.isModified(), "record is modified according to isModified()");


                // record = dmgr.getRecord("tree", "Elm");
                // test.ok(record.status === "L", "loading an existing record");
                // return record.getReadyPromise();
                dmgr.save();
                test.ok(record.status === "S", "record is saving");
            } catch (e) {
                dmgr.report(e);
            }
            return record.getReadyPromise();
        })
        .then(function () {
            var record = dmgr.getRecordNullIfNotInCache("tree", "Elm");
            test.ok(record && (record.getUUID() === "tree:Elm"), "Elm record is in cache");

            test.ok(record.status === "U", "record is unmodified according to status property");
            test.ok(!record.isModified(), "record is unmodified according to isModified()");


    // kill dmgr and re-create...

            dmgr = Data.DataManagerDocs.clone({
                id: "Test",
                store: store,
                instance: true,
            });
            record = dmgr.getRecordNullIfNotInCache("tree", "Elm");
            test.ok(!record, "Elm record is NOT in cache");

            record = dmgr.getRecord("tree", "Elm");
            test.ok(record.status === "L", "record is loading");

            return record.getReadyPromise();
        })
        .then(function () {
            var record = dmgr.getRecordNullIfNotInCache("tree", "Elm");
            test.ok(record && (record.getUUID() === "tree:Elm"), "Elm record is in cache");
            test.ok(record.getField("location").getText() === "Ashton-under-Lyme", "saved change retrieved");
            test.ok(record.status === "U", "record is unmodified according to status property: " + record.status);
            test.ok(!record.isModified(), "record is unmodified according to isModified()");

            try {
                record.getField("species").set("Oak");
                test.ok(false, "could change key of existing record");
            } catch (e) {
                test.ok(true, "can't change key of existing record");
            }
            test.ok(record.status === "U", "record is still unmodified according to status property: " + record.status);
            test.ok(!record.isModified(), "record is still unmodified according to isModified()");
            test.ok(dmgr.getRecordCount().modified_total === 0, "no modified records");
            try {
                dmgr.save();
                test.ok(false, "can save if no modified records to save");
            } catch (e) {
                test.ok(true, "can't save if no modified records to save");
            }
            record.getField("location").set("");
            test.ok(!record.isValid(), "location set blank, record is not valid");
            test.ok(!record.getField("location").isValid(), "location set blank, field is not valid");
            try {
                dmgr.save();
                test.ok(false, "can save if record(s) invalid");
            } catch (e) {
                test.ok(true, "can't save if record(s) invalid");
            }

            record.getField("location").set("Bolton");
            try {
                dmgr.save();
                test.ok(record.status === "S", "record is saving");
            } catch (e) {
                dmgr.report(e);
            }
            return record.getReadyPromise();
        })
        .then(function () {
            var record = dmgr.getRecordNullIfNotInCache("tree", "Elm");
            test.ok(record && (record.getUUID() === "tree:Elm"), "Elm record is in cache");
            test.ok(record.getField("location").getText() === "Bolton", "saved change retrieved");
            test.ok(record.status === "U", "record is unmodified according to status property: " + record.status);
            test.ok(!record.isModified(), "record is unmodified according to isModified()");

            record.setDelete(true);
            test.ok(record.isDelete(), "Elm record to be deleted");
            try {
                dmgr.save();
                test.ok(record.status === "S", "record is saving");
            } catch (e) {
                dmgr.report(e);
            }
            return record.getReadyPromise();
        })
        .then(function () {
            var record = dmgr.getRecordNullIfNotInCache("tree", "Elm");
            test.ok(!record, "Elm record is NOT in cache");
        })
        .then(null, function (error) {
            test.ok(false, error);
        })
        .then(function () {
            test.done();
        });
};
