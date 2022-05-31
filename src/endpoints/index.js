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
const { respondOk, respondError } = require('@viero/common-nodejs/http/server/respond');
const { VieroHTTPError, http404 } = require('@viero/common-nodejs/http/server/error');
const { VieroError } = require('@viero/common/error');
const { from, to, purge } = require('../cache');
const { fetch } = require('../fetch');

const log = new VieroLog('cdn/endpoints');

const fetchWrite = (cacheKey, path, headers, head) => fetch(path, headers)
  .then(([url, res, fetched]) => to(res.statusCode, res.headers, cacheKey, fetched, head)
    .then(([statusCode, fHeaders, stream]) => ([url, statusCode, fHeaders, stream])));

const getOrAdd = ({
  cacheKey, path, headers, head,
}) => from(cacheKey, head)
  .then(([statusCode, fHeaders, stream]) => ([statusCode, fHeaders, stream, '>', 'cache']))
  .catch((err) => {
    if (err.code !== 'ENOENT') throw err; // TODO: VieroError/FS
    return fetchWrite(cacheKey, path, headers, head)
      .then(([url, statusCode, fHeaders, stream]) => ([statusCode, fHeaders, stream, '>', url]));
  });

const remove = ({
  cacheKey,
}) => purge(cacheKey);

const respondWithStream = (statusCode, headers, stream, url, sign, source, t, res) => {
  res.statusCode = statusCode;
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  if (stream) {
    stream.on('end', () => {
      if (log.isDebug()) log.debug(200, `${Date.now() - t}ms`, url, sign, source);
    });
    stream.pipe(res);
    return;
  }
  res.end();
};

const respondWithError = (err, url, t, res) => {
  if (err instanceof VieroHTTPError) {
    res.statusCode = err.httpCode;
    res.statusMessage = err.httpMessage;
    if (log.isWarning()) {
      log.warning(
        res.statusCode, `${Date.now() - t}ms`, url, '!',
        err.get('url') || (err.get(VieroError.KEY.ERROR) ? err.get(VieroError.KEY.ERROR).message : 'unknown'),
      );
    }
  } else {
    res.statusCode = 500;
    res.statusMessage = 'Internal server error';
    if (log.isError()) {
      log.error(res.statusCode, `${Date.now() - t}ms`, url, '!', err.message);
    }
  }
  res.end();
};

const genCacheKey = ({ pathParams: { path }, headers: { range } }) => {
  const pathWithoutQuery = path.split('?').shift();
  if (range) {
    return Buffer.from(`${pathWithoutQuery}?${range}`).toString('base64');
  }
  return Buffer.from(`${pathWithoutQuery}`).toString('base64');
};

const get = ({
  cacheKey, path, url, headers, res, head, t = Date.now(),
}) => Promise
  .try(() => getOrAdd({
    cacheKey, path, headers, head,
  }))
  .then(([statusCode, fHeaders, stream, sign, source]) => respondWithStream(
    statusCode, fHeaders, stream, url, sign, source, t, res,
  ))
  .catch((err) => respondWithError(err, url, t, res));

module.exports = {

  register(server) {
    const route = server.route('/:path...');
    route.head(({
      req,
      req: { pathParams: { path }, url, headers },
      res,
    }) => get({
      cacheKey: genCacheKey(req), path, url, headers, res, head: true,
    }));
    route.get(({
      req,
      req: { pathParams: { path }, url, headers },
      res,
    }) => get({
      cacheKey: genCacheKey(req),
      path,
      url,
      headers,
      res,
      head: false,
    }));

    server.delete(
      '/:cacheKey',
      ({ req: { pathParams: { cacheKey } }, res }) => Promise
        .try(() => remove({ cacheKey }))
        .then(() => respondOk(res))
        .catch((err) => {
          if (err.code === 'ENOENT') return respondError(res, http404());
          return respondError(res, err);
        }),
    );

    return Promise.resolve();
  },
};
