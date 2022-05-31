/**
 * Copyright 2020 Viero, Inc.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

const { VieroLog } = require('@viero/common/log');
const { VieroHTTPClient } = require('@viero/common-nodejs/http/client');
const { errorCode } = require('@viero/common-nodejs/http/server/error');

const log = new VieroLog('cdn/fetch');
let maps = {};

module.exports = {
  setMapping: (mapping) => {
    // eslint-disable-next-line no-param-reassign
    if (log.isInfo()) log.info('host mapping is set as');
    maps = mapping.reduce((acc, curr) => {
      const match = (curr).match(/[a-z0-9\-\.]*\:/)[0];
      if (2 < match.length) {
        acc[match.slice(0, -1)] = new URL(curr.slice(match.length));
      }
      return acc;
    }, {});
    if (log.isInfo()) Object.keys(maps).forEach((key) => log.info(`${key} => ${maps[key].toString()}`));
  },
  fetch: (path, headers) => {
    const host = headers['host'].match(/[a-z0-9\-\.]*\:/)[0].slice(0, -1);
    const url = `${maps[host].href}${path}`;
    headers = {
      ...JSON.parse(JSON.stringify(headers)),
      host: maps[host].host,
    };
    console.log(url, headers);
    const { connection: trash1, 'keep-alive': trash2, ...keepHeaders } = headers;
    return VieroHTTPClient.request({
      url, headers: keepHeaders,
    })
      .then((res) => {
        if (200 <= res.statusCode && res.statusCode < 400) return Promise.all([url, res, res.data()]);
        throw errorCode({ code: res.statusCode, message: res.statusMessage, userData: { url } });
      }).catch((err) => {
        debugger;
        throw err;
      });
  },
};
