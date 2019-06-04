import { leaf, option } from '@carnesen/cli';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { DOCKER_FILE, DOCKER_URL, isDevEnd } from '../misc';

export default leaf({
  commandName: 'download',
  description:
    'Download a docker release file and extract it to the current directory.',

  options: {
    version: option({
      typeName: 'string',
      nullable: true,
      defaultValue: 'latest',
      description: 'Version number to download, eg v2.0.0',
    }),
  },

  async action({ version }) {
    const url = isDevEnd()
      ? 'http://localhost:8080/rise-docker.tar.gz'
      : DOCKER_URL + version + '/' + DOCKER_FILE;

    console.log(`Downloading ${url}`);

    const file = fs.createWriteStream(DOCKER_FILE);
    // TODO show progress ?
    await new Promise((resolve, reject) => {
      // use plain http when in DEV mode
      (process.env['DEV'] ? http : https)
        .get(url, function(response) {
          response.pipe(file);
          file.on('finish', function() {
            file.close();
            resolve();
          });
        })
        .on('error', function(err) {
          fs.unlink(DOCKER_FILE, () => {
            reject(err.message);
          });
        });
    });

    console.log('Download completed');
    console.log(`Extracting ${DOCKER_FILE}`);

    execSync(`tar -zxf ${DOCKER_FILE}`);
    await new Promise((resolve) => {
      fs.unlink(DOCKER_FILE, resolve);
    });

    console.log('Done.\n');
    console.log('You can start the container using:');
    console.log('  ./rise docker start');
  },
});
