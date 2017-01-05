/* global: window */

"use strict";

var Core = require("lapis-core");
var UI = require("lapis-ui");
var url = require("url");


module.exports = Core.Base.clone({
    id: "Controller",
    data_manager: null,
    selectors: null,
    page: null,
    default_home: "home",
});


if (window) {
    window.controller = module.exports;
}

module.exports.define("hashChange", function (href) {
    var hash = url.parse(href).hash || "";
    var params;

    if (hash) {
        hash = hash.substr(1);
    }
    this.debug("hashChange(): " + hash);
    params = this.getParamsFromHash(hash);
    // alert user if page has unsaved data
    params.page_id = params.page_id || this.default_home;
    this.page = this.getPageFromParams(params);
    this.page.render();
});


module.exports.define("getParamsFromHash", function (hash) {
    var parts = hash.split("&");
    var out = {};

    parts.forEach(function (part) {
        var parts2 = part.split("=");
        out[parts2[0]] = (parts2.length > 1 ? parts2[1] : null);
    });
    return out;
});


module.exports.define("getPageFromParams", function (params) {
    var page_id = params.page_id;
    if (!page_id) {
        this.throwError("no page_id parameter supplied");
    }
    return UI.Page.getPageThrowIfNotFound(page_id).clone({
        id: page_id,
        instance: true,
        page_key: params.page_key,
        data_manager: this.data_manager,
        selectors: this.selectors,
    });
});
