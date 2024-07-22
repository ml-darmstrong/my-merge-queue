import { Octokit } from 'octokit';
import { step, StepOptions } from './merge-queue.mjs';
const NAME_REGEX = /^[a-z0-9-]+$/

// Octokit.js
// https://github.com/octokit/core.js#readme
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
})

function printUsage() {
    console.log(`Usage: npm start -- --owner <owner> --repo <repo> [--author <author>] [--automerge] [--requireAllChecks]`);
}

function exit(reason: string) {
    console.error(reason);
    printUsage();
    process.exit(1);
}

function getRunOptions() {
    const runOptions: StepOptions = {
        octokit,
        owner: '',
        repo: '',
    }

    for (let i = 2; i < process.argv.length; ) {
        const arg = process.argv[i];
        switch (arg.toLowerCase()) {
            case '--automerge': {
                runOptions.autoMerge = true;
                i++;
                break;
            }
            case '--requireallchecks': {
                runOptions.requireAllChecks = true;
                i++;
                break;
            }
            case '--repo': {
                runOptions.repo = process.argv[i+1];
                if (!NAME_REGEX.test(runOptions.repo)) {
                    exit(`Invalid repo ${runOptions.repo}`);
                }
                i += 2;
                break;
            }
            case '--owner': {
                runOptions.owner = process.argv[i+1];
                if (!NAME_REGEX.test(runOptions.owner)) {
                    exit(`Invalid owner ${runOptions.owner}`);
                }
                i += 2;
                break;
            }
            case '--author': {
                runOptions.author = process.argv[i+1];
                if (!NAME_REGEX.test(runOptions.author)) {
                    exit(`Invalid author ${runOptions.author}`);
                }
                i += 2;
                break;
            }
            default: {
                exit(`Unknown option ${arg}`);
            }
        }
    }

    return runOptions;
}

// Main

const runOptions = getRunOptions();

async function run() {
    await step(runOptions);
    console.log(`Retry in 5 minutes`);
    setTimeout(() => run(), 1000*60*5)
}
run();
