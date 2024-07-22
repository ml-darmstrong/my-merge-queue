import { Octokit } from 'octokit';
import { MergePullRequestInput, MergePullRequestPayload, PullRequest, Repository, UpdatePullRequestBranchInput, UpdatePullRequestPayload } from '@octokit/graphql-schema';

async function searchPullRequests(octokit: Octokit, input: { owner: string, repo: string }) {
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

async function compare(octokit: Octokit, input: { owner: string, repo: string, target: string, headRef: string}) {
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


async function mergePullRequest(octokit: Octokit, input: MergePullRequestInput) {
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

async function updatePullRequestBranch(octokit: Octokit, input: UpdatePullRequestBranchInput) {
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



export type StepOptions = {
    octokit: Octokit, 
    owner: string
    repo: string
    author?: string
    autoMerge?: boolean
    requireAllChecks?: boolean
}
export async function step({ octokit,  owner, repo, author, autoMerge, requireAllChecks }: StepOptions) {

    console.log(`Checking for approved PRs on ${owner}/${repo}`);
    const pullRequests = await searchPullRequests(octokit, { owner, repo });
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
    const compResult = await compare(octokit, {owner, repo, target: pr.baseRefName, headRef: pr.headRefName});

    if (!compResult) {
        console.error(`No comparison result`);
        return;
    }

    console.log(`Branch status: ${compResult.status}`);
    console.log(`Branch is behind by ${compResult.behindBy} commits`);

    if (compResult.behindBy > 0) {
        console.log(`Updating branch`);
        const updateResult = await updatePullRequestBranch(octokit, { pullRequestId: pr.id, updateMethod: "MERGE" });
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
                const mergeResult = await mergePullRequest(octokit, { pullRequestId: pr.id, mergeMethod: "SQUASH" });
                console.log(mergeResult)
            } catch(e) {
                console.error(`Merge failed`);
                console.log(e);
            }
        }
    }
}
