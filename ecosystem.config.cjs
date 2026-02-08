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
  ],
};
