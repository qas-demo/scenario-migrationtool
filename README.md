# qspec-migrationtool
This tool migrates the data from qTest Scenario v1 to Scenario v2

# Software Requirements
Git,
NPM,
Node,
MongoDB/MongoDB Compass,
PostgreSQL/pgadmin, 
JIRA,
VCS (Github/GitHub Enterprise/Bitbucket Cloud/Bitbucket Server),
Scenario v1 and v2.

# How to Install/Run the Tool
1. Install and connect Scenario v2 with MongoDB, JIRA, VCS, and qTest
2. Make sure MongoDB is up and running
3. Clone the repository from GitHub(https://github.com/qas-demo/qspec-migrationtool)
4. Setup Configuration File* according to your vcs(Make sure you provide all the credentials correctly)
    jirausername,
    jiraemail,
    jiraaccesstoken,
    jiraprojectkey,
    vcsusername,
    vcsreponame,
    vcspassword/vcspersonalaccesstoken,
    qtestdomain,
    qtestusername,
    qtestaccesstoken,
    pghostname,
    pgusername,
    pgpassword,
    pgdbname,
    mongourl.
5. Using command line/terminal, move into the cloned repository
6. Run, node vcsname.js (github, githubenterprise, bitbucketcloud, bitbucketserver)
7. If anything goes wrong, the script will throw an error and those errors will be stored in the log file
8. Do changes according to the log file errors and re-run the script.
9. After running the script, check JIRA, VCS and MongoDB for changes.
