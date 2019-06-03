import { leaf, option } from '@carnesen/cli';
import { exec, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DOCKER_DIR, log, MIN } from '../misc';

export default leaf({
  commandName: 'start',
  description: 'Starts a container using the provided config',

  options: {
    config: option({
      typeName: 'string',
      nullable: true,
      defaultValue: `${DOCKER_DIR}/config.json`,
      description: 'Path to the config file',
    }),
    network: option({
      typeName: 'string',
      nullable: true,
      defaultValue: 'mainnet',
      allowedValues: ['mainnet', 'testnet'],
    }),
    foreground: option({
      typeName: 'boolean',
      nullable: true,
      defaultValue: false,
      description: 'Keep the process in the foreground. Implies --show_logs',
    }),
    show_logs: option({
      typeName: 'boolean',
      nullable: true,
      defaultValue: false,
      description: 'Stream the console output',
    }),
  },

  async action({ config, network, foreground, show_logs }) {
    if (!checkDockerDirExists()) {
      return;
    }
    const configPath = path.resolve(config);
    if (!fs.existsSync(configPath)) {
      console.log("ERROR: Config file doesn't exist.");
      return;
    }
    const showLogs = show_logs || foreground;

    // TODO check if docker is running
    try {
      await dockerRemove();
      await dockerBuild(showLogs);
      await dockerRun(configPath, network, foreground, showLogs);
    } catch (err) {
      console.log(
        'Error while building the container. Examine the log using --show_logs.'
      );
      console.error(err);
      process.exit(1);
    }
  },
});

async function dockerRemove() {
  console.log('Removing the previous container...');

  const cmd = 'docker rm rise-node';
  log('$', cmd);
  try {
    execSync(cmd);
  } catch {
    // skip the error
  }
}

async function dockerBuild(showLogs: boolean) {
  console.log('Building the image...');

  // build
  await new Promise((resolve, reject) => {
    const cmd = 'docker build -t rise-local/node .';
    log('$', cmd);
    const proc = exec(cmd, {
      timeout: 5 * MIN,
      cwd: path.resolve(__dirname, DOCKER_DIR),
    });
    function line(data: string) {
      if (showLogs) {
        process.stdout.write(data);
      } else {
        log(data);
      }
    }
    proc.stdout.on('data', line);
    proc.stderr.on('data', line);
    proc.on('close', (code) => {
      log('close', code);
      code ? reject(code) : resolve(code);
    });
  });

  log('build done');
  console.log('Build complete');
}

// TODO mount the DB logs dir
// TODO mount the data dir
async function dockerRun(
  config: string,
  network: string,
  foreground: boolean,
  showLogs: boolean
) {
  console.log('Stating the container...');
  let ready = false;
  await new Promise((resolve, reject) => {
    const cmd =
      `docker run --name rise-node ` +
      `-v ${config}:/home/rise/config.json rise-local/node`;
    log('$', cmd);
    const proc = exec(cmd, {
      timeout: 2 * MIN,
      env: {
        NETWORK: network,
      },
      cwd: path.resolve(__dirname, DOCKER_DIR),
    });
    function line(data: string) {
      if (showLogs) {
        process.stdout.write(data);
      } else {
        log(data);
      }
      // check if the output reached the desired line
      if (data.includes('Blockchain ready')) {
        ready = true;
        // keep streaming the output if in the foreground
        if (!foreground) {
          resolve();
        }
      }
    }
    proc.stdout.on('data', line);
    proc.stderr.on('data', line);
    proc.on('close', (code) => {
      log('close', code);
      code ? reject(code) : resolve(code);
    });
  });
  log('run done');
  if (!ready) {
    console.log('Something went wrong. Examine the log using --show_logs.');
    process.exit(1);
  }
  console.log('Container started');
}

function checkDockerDirExists(): boolean {
  if (!fs.existsSync(DOCKER_DIR) || !fs.lstatSync(DOCKER_DIR).isDirectory()) {
    console.log(`Error: directory '${DOCKER_DIR}' doesn't exist.`);
    console.log(`You can download the latest version using:`);
    console.log(`  ./rise docker download`);
    return false;
  }
  return true;
}
