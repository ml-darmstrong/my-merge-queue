import { Octokit } from 'octokit';
import * as core from '@actions/core';
import { createActionAuth } from "@octokit/auth-action";
import { step } from './merge-queue.mjs';

const octokit = new Octokit({
    authStrategy: createActionAuth,
});

async function run() {
  try {
      let repository = core.getInput('repository');
      if (!repository && process.env['GITHUB_REPOSITORY']) {
          repository = process.env['GITHUB_REPOSITORY'];
      }
      if (!repository) {
          throw new Error('Could not determine repository.');
      }

      const [owner, repo] = repository.split('/'); 
      const options = {
          octokit,
          owner,
          repo,
          autoMerge: core.getInput('autoMerge').toLowerCase() === 'true',
          requireAllChecks: core.getInput('requireAllChecks').toLowerCase() === 'true',
      }

      step(options);
  } catch (error) {
      if (typeof error === 'string') {
          core.setFailed(error);
      } else if (error instanceof Error) {
          core.setFailed(error.message)
      } else {
          core.setFailed('Unknown error');
      }
  }
}

run();
