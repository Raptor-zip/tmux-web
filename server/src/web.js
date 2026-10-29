import path from 'node:path';
import express from 'express';
import compression from 'compression';

/** Serve public build assets without applying compression to API or file data. */
export function installWeb(app, root) {
  app.use(compression({
    filter: (req, res) => ['GET', 'HEAD'].includes(req.method)
      && req.path.startsWith('/assets/') && !req.headers.range
      && compression.filter(req, res),
  }));
  app.use(express.static(root));
  app.get('*', (req, res, next) => {
    if (['/api', '/ws', '/files'].some(prefix => req.path.startsWith(prefix))) return next();
    if (req.path.startsWith('/assets/')) return res.sendStatus(404);
    res.sendFile(path.join(root, 'index.html'));
  });
}
