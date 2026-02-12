module.exports = {
  apps: [
    {
      name: 'lochcad',
      script: 'npx',
      args: 'vite preview --port 3800 --host',
      cwd: '/var/www/node/LochCAD',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'lochcad-collab',
      script: 'server/collab-server.cjs',
      cwd: '/var/www/node/LochCAD',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
