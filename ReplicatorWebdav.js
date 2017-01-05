"use strict";

var ReplicatorBase = require("./ReplicatorBase.js");
var Promise = require("q");
var jQuery = require("jquery-core");


module.exports = ReplicatorBase.clone({
    id: "ReplicatorWebdav",
});


// server_props_all is a map object keyed on uuid, each value being a map object: uuid, etag,
// last_mod, length
module.exports.define("getServerAllDocSummary", function () {
    var that = this;
    return new Promise(function (resolve, reject) {
        jQuery.ajax({
            url: that.url,
            type: "PROPFIND",
            timeout: that.ajax_timeout,
            data: "<?xml version='1.0' encoding='utf-8' ?><D:propfind xmlns:D='DAV:'><allprop/></D:propfind>",
            beforeSend: function (jq_xhr) {
                jq_xhr.setRequestHeader("If-Modified-Since", "");      // needed for IOS6 and Chrome 24+
            },
            success: function (data, text_status, jq_xhr) {
                resolve(that.processCollection(data));
            },
            error: that.ajaxError,
        });
    });
});


module.exports.define("processCollection", function (xml_doc) {
    var responses = xml_doc.getElementsByTagName("response");
    var server_props_all = {};
    responses.forEach(function (response) {
        var item = this.processResponse(response);
        if (item.uuid) {
            server_props_all[item.uuid] = item;
        }
    });
    return server_props_all;
});


module.exports.define("processResponse", function (xml_element) {
    return {
        uuid: this.getXMLValue(xml_element, "displayname"),
        etag: this.getXMLValue(xml_element, "getetag"),
        last_mod: this.getXMLValue(xml_element, "getlastmodified"),
        length: this.getXMLValue(xml_element, "getcontentlength"),
    };
});


module.exports.define("deleteServer", function (uuid) {
    var that = this;
    this.log("deleteServer()");
    jQuery.ajax({
        url: this.url + uuid,
        type: "DELETE",
        timeout: this.ajax_timeout,
        success: function (data, text_status, jq_xhr) {
            that.setOnline(true);
        },
        error: that.ajaxError,
    });
});


module.exports.define("pushToServer", function (doc_obj) {
    var that = this;
    this.debug("pushToServer()");
    jQuery.ajax({
        url: this.url + doc_obj.uuid,
        type: "PUT",
        data: doc_obj.content,
        timeout: this.ajax_timeout,
        beforeSend: function (jq_xhr) {
            jq_xhr.setRequestHeader("If-Modified-Since", "");      // needed for IOS6 and Chrome 24+
        },
        success: function () {
            that.setOnline(true);
            jQuery.ajax({
                url: that.url + doc_obj.uuid,
                type: "HEAD",
                timeout: that.ajax_timeout,
                success: function (data, text_status, jq_xhr) {
                    var headers = that.getHeaders(jq_xhr);
                    that.setOnline(true);
//                  doc_obj.server_last_repl = this_replication.getTime();
                    that.setDocPropertiesFromHeaders(headers, doc_obj);
                    that.updateReplStatus(doc_obj, "Synced");
                    that.store.storeDoc("dox", doc_obj);
//                    that.log(y.view(y.getHeaders(jq_xhr)));
                    that.debug("pushToServer() success  HEAD: data: " + that.view(data) + ", text_status: " + String(text_status) + ", jq_xhr: " + that.view(jq_xhr));
//                  that.setDavProperties(doc_obj.uuid, { doc_title: doc_obj.title });
                },
                error: function (a, b, c) {
                    that.online = false;
//                  that.log(y.view(y.getHeaders(c)));
// that.log("pushToServer() error in HEAD: data: " + that.view(data) + ", text_status: " + String(text_status) + ", jq_xhr: "  + that.view(jq_xhr));
                },
            });
        },
        error: that.ajaxError,
    });
});

module.exports.define("pullFromServer", function (doc_obj, item_callback) {
    var that = this;
    this.log("pullFromServer(): " + doc_obj.uuid);
    jQuery.ajax({
        url: this.url + doc_obj.uuid,
        type: "GET",
        timeout: this.ajax_timeout,
        dataType: "text",
        beforeSend: function (jq_xhr) {
            jq_xhr.setRequestHeader("If-Modified-Since", "");      // needed for IOS6 and Chrome 24+
        },
        success: function (data, text_status, jq_xhr) {
            var headers;
            that.setOnline(true);
            that.log("pullFromServer() HTTP status code: " + jq_xhr.status + ", or in text: " + jq_xhr.statusText);
            headers = that.getHeaders(jq_xhr);
            that.log(y.view(headers));
            that.updateReplStatus(doc_obj, "Synced");
            doc_obj.content = data;
//          doc_obj.server_etag          = server_etag;
            that.setDocPropertiesFromHeaders(headers, doc_obj);
            that.log("Setting server_etag: " + doc_obj.server_etag);
            x.store.storeDoc("dox", doc_obj);
            if (typeof item_callback === "function") {
                item_callback(doc_obj);
            }
        },
        error: that.ajaxError,
    });
});


// ------------------------------------------------------------------------------ HTTP Headers
module.exports.define("getHeaders", function (http) {
    var headers = http.getAllResponseHeaders().split("\r\n");
    var obj = {};
    headers.forEach(function (header) {
        var parts = header.split(": ");
        if (parts[0]) {
            obj[parts[0]] = parts[1];
        }
    });
    return obj;
//  that.log(headers);
});

module.exports.define("setDocPropertiesFromHeaders", function (headers, doc_obj) {
    doc_obj.server_last_modified = headers["Last-Modified"];
    doc_obj.server_length = headers["Content-Length"];
    doc_obj.server_etag = headers.ETag || headers.Etag;  // HEAD returns diff header from PROPFIND?
    this.log("Setting server_etag to: " + doc_obj.server_etag);
});

/*
need to call HTTP PROPFIND
<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:"><allprop/></D:propfind>

OR
<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
     <D:prop>
       <D:displayname/>
       <D:getcontentlength/>
       <D:getetag/>
       <D:getlastmodified/>
       <D:resourcetype/>
     </D:prop>
</D:propfind>
*/
//  that.log("status: " + that.getXMLValue(xml_element, "status"          ));
//  that.log("creatd: " + that.getXMLValue(xml_element, "creationdate"    ));
//  that.log("dispnm: " + that.getXMLValue(xml_element, "displayname"     ));
//  that.log("lstmod: " + that.getXMLValue(xml_element, "getlastmodified" ));
//  that.log("contln: " + that.getXMLValue(xml_element, "getcontentlength"));
//  that.log("etaggg: " + that.getXMLValue(xml_element, "getetag"         ));

module.exports.define("getXMLValue", function (xml_parent, tagname) {
    var item = xml_parent.getElementsByTagName(tagname).item(0);
    if (item) {
        return item.textContent;
    }
    return null;
});

// This doesn't work for some reason
module.exports.define("setDavProperties", function (doc_id, prop_map) {
    var that = this,
        data_str = '<?xml version="1.0" encoding="utf-8" ?><D:propertyupdate xmlns:D="DAV:"><D:set>',
        prop;

    this.log("setDavProperties()");
    for (prop in prop_map) {
        if (prop_map.hasOwnProperty(prop)) {
            data_str += "<D:prop><" + prop + ">" + prop_map[prop] + "</" + prop + ">";
        }
    }
    data_str += "</D:set></D:propertyupdate>";
    this.log(data_str);
    jQuery.ajax({ url: this.url + doc_id, type: "PROPPATCH", timeout: this.ajax_timeout, data: data_str,
        beforeSend: function (jq_xhr) {
            jq_xhr.setRequestHeader("If-Modified-Since", "");      // needed for IOS6 and Chrome 24+
        },
        success: function (data, text_status, jq_xhr) {
            var headers;
            that.setOnline(true);
            that.log("setDavProperties: " + jq_xhr.status + ", or in text: " + jq_xhr.statusText);
//          that.log(a);
            that.processCollection(data);
            headers = that.getHeaders(jq_xhr);
            that.log(y.view(headers));
        },
        error: that.ajaxError,
    });
});
