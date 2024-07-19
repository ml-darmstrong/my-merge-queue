import { Octokit } from 'octokit';
import { MergePullRequestInput, MergePullRequestPayload, PullRequest, Repository, UpdatePullRequestBranchInput, UpdatePullRequestPayload } from '@octokit/graphql-schema';

const NAME_REGEX = /^[a-z0-9-]+$/

// Octokit.js
// https://github.com/octokit/core.js#readme
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
})

async function searchPullRequests(input: { owner: string, repo: string }) {
    const query = `
    query ($owner:String!, $repo: String!, $num: Int = 10, $cursor: String) {
        repository(owner: $owner, name: $repo) {
            pullRequests(states: [OPEN], first: $num, after: $cursor) {
                edges {
                    node {
                        id
                        title
                        author {
                            login
                        }
                        number
                        headRefName
                        headRefOid
                        baseRefName
                        mergeable
                        checksUrl
                        reviewDecision
                        statusCheckRollup {
                            state
                        }
                    }
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }
    }
    `;

    const response = await octokit.graphql.paginate<{ repository: Repository }>(
        query,
        {
            owner: input.owner,
            repo: input.repo,
        });

    return response.repository.pullRequests?.edges;
}

async function compare(input: { owner: string, repo: string, target: string, headRef: string}) {
    const query = `
        query ($owner: String!, $repo: String!, $target: String!, $headRef: String!) {
        repository(owner: $owner, name: $repo) {
            ref(qualifiedName: $target) {
                compare(headRef: $headRef) {
                    behindBy
                    aheadBy
                    status
                }
            }
        }
        }
    `;
    const response = await octokit.graphql<{ repository: Repository }>(query, input);

    return response.repository.ref?.compare;
}


async function mergePullRequest(input: MergePullRequestInput) {
    const query = `
    mutation ($input: MergePullRequestInput!) {
        mergePullRequest(input: $input) {
            clientMutationId
        }
    }
    `;
    
    const response = await octokit.graphql<{ mergePullRequest: MergePullRequestPayload }>( query, { input });
    return response.mergePullRequest;
}

async function updatePullRequestBranch(input: UpdatePullRequestBranchInput) {
    const query = `
    mutation ($input: UpdatePullRequestBranchInput!) {
        updatePullRequestBranch(input: $input) {
            clientMutationId
        }
    }
    `;
    const response = await octokit.graphql<{ updatePullRequestBranch: UpdatePullRequestPayload }>( query, { input });
    return response.updatePullRequestBranch;
}



type StepOptions = {
    owner: string
    repo: string
    author?: string
    autoMerge?: boolean
    requireAllChecks?: boolean
}
async function step({ owner, repo, author, autoMerge, requireAllChecks }: StepOptions) {

    const pullRequests = await searchPullRequests({ owner, repo });
    if (!pullRequests) {
        console.log(`Could not find any PRs`);
        return;
    }

    let pr: PullRequest | undefined = undefined;
    for (const it of pullRequests) {
        const other = it?.node;
        if (
            other &&
            (other.reviewDecision === 'APPROVED') &&
            (pr === undefined || other.number < pr.number) &&
            (author === undefined || other.author?.login === author)
        ) {
            pr = other;
        }
    }

    if (!pr) {
        let message = `Could not find any APPROVED PRs`  
        if (author) {
            message += ` with author ${author}`;
        }
        console.log(message);
        return;
    }

    console.log(`PR ${pr.number} ${pr.title}`);
    console.log(`  Status: ${pr.statusCheckRollup?.state}`);

    console.log(`Comparing ${pr.baseRefName} to ${pr.headRefName}`);
    const compResult = await compare({owner, repo, target: pr.baseRefName, headRef: pr.headRefName});

    if (!compResult) {
        console.error(`No comparison result`);
        return;
    }

    console.log(`Branch status: ${compResult.status}`);
    console.log(`Branch is behind by ${compResult.behindBy} commits`);

    if (compResult.behindBy > 0) {
        console.log(`Updating branch`);
        const updateResult = await updatePullRequestBranch({ pullRequestId: pr.id, updateMethod: "MERGE" });
        console.log(updateResult)
        return;
    }

    if (autoMerge) {
    if (pr.statusCheckRollup?.state === 'PENDING') {
        console.log(`Checks still pending`);
    } else if (requireAllChecks && pr.statusCheckRollup?.state !== 'SUCCESS') {
        console.log(`Checks not successful`);
    } else {
        try {
            console.log(`Merging PR ${pr.number} ${pr.title}`);
            const mergeResult = await mergePullRequest({ pullRequestId: pr.id, mergeMethod: "SQUASH" });
            console.log(mergeResult)
        } catch(e) {
            console.error(`Merge failed`);
            console.log(e);
        }
    }
    }
}

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
