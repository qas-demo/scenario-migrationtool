var Pool = require('pg').Pool;
var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');
var axios = require('axios');
var Base64 = require('js-base64').Base64;
var fs = require('fs');

var log4js = require('log4js');

log4js.configure({ 
    appenders: 
    {   
        consoleAppender: { type: 'stdout' },
        fileAppender: { type: 'file', filename: 'output.log' },
    },
    categories: { 
        default: { appenders: ['consoleAppender', 'fileAppender'], level: 'debug' },
    },
});

const logger = log4js.getLogger('Scenario v1 to v2');

var filterObj = [];
var issueArray = [];
var issuekeyArray = [];
var jiraUser;
var jiraActive;
var featureArray = [];
var featurefolderArray = [];
var featuredataArray = [];
var nameArray = [];
var normalizednameArray = [];
var objAccount = {};
var objFeature = {};
var objProject = {};
var shaArray = [];
var reverseshaArray = [];
var pathArray = [];
var delShaArray = [];
var date = new Date();
var jiraProjectID;
var jiraProjectName;
var isQtestAccountActive;
var qUsername;
var qDomain;
var vcsUrl;
var vcsBranch;
var vcsPrivate;

var filename = "./githubenterprise-config.json";
var getValues = async function(callback) {
    logger.debug("Script started running!");
    var filedata = fs.readFileSync(filename, 'utf8');
    var jsonObj = JSON.parse(filedata);

    if(jsonObj !== null && typeof jsonObj === 'object') {
        var url = jsonObj.jirausername;
        var email = jsonObj.jiraemail;
        var jiratoken = jsonObj.jiraaccesstoken;
        var projectkey = jsonObj.jiraprojectkey;
    
        var enterpriseurl = jsonObj.githuburl;
        var ownername = jsonObj.githubusername;
        var reponame = jsonObj.githubreponame;
        var githubtoken = jsonObj.githubpersonalaccesstoken;
    
        var qtestusername = jsonObj.qtestusername;
        var qtestdomain = jsonObj.qtestdomain;
        var qtestaccesstoken = jsonObj.qtestaccesstoken;
    
        var pghostname = jsonObj.pghostname;
        var pgusername = jsonObj.pgusername;
        var pgpassword = jsonObj.pgpassword;
        var pgdbname = jsonObj.pgdbname;
        var accountname = jsonObj.accountname;

        var octokit = require('@octokit/rest')({
            debug: true,
            baseUrl: enterpriseurl+'/api/v3'
        });
            
        var dburl = jsonObj.mongourl;

        var pool = new Pool({
            host: pghostname,
            port: 5432,
            database: pgdbname,
            user: pgusername,
            password: pgpassword
        });
        var queryString = {
            text: 'SELECT t_feature.issue_id as "issueId", t_instance.client_key as "clientKey", t_feature_file_snapshot.content as "content" FROM t_feature INNER JOIN t_instance ON t_feature.instance_id = t_instance.id INNER JOIN t_feature_file_snapshot ON t_feature.id = t_feature_file_snapshot.feature_id WHERE t_instance.client_key = $1',
            values: [accountname]
        }
        pool.query(queryString, function (err, res) {
            if (err) {
                logger.error(err.stack);
            } else {
                logger.debug("Got data from PostgreSQL for the Clientkey "+accountname);
                var pgObj = res.rows;
                function removeDuplicates(originalArray, prop) {
                    var newArray = [];
                    var lookupObject  = {};
                    for(var i in originalArray) {
                       lookupObject[originalArray[i][prop]] = originalArray[i];
                    }
               
                    for(i in lookupObject) {
                        newArray.push(lookupObject[i]);
                    }
                    return newArray;
                }
        
                var actualObj = removeDuplicates(pgObj, "issueId");
                getProjectData(actualObj);
            }
            pool.end();
        });

        var getProjectData = async function(actualObj) {
            for(var i=0; i<actualObj.length; i++) {    
                try {
                    var response = await axios.get(url+'/rest/api/2/issue/'+actualObj[i].issueId, { auth: { username: email, password: jiratoken } });
                    if(response.status == 200) {
                        if(response.data.fields.project.key == projectkey) {
                            issueArray.push(response.data.id);
                            issuekeyArray.push(response.data.key);
                            jiraProjectID = response.data.fields.project.id;
                            jiraProjectName = response.data.fields.project.name;
                        }
                    }

                    var userResponse = await axios.get(url+'/rest/api/2/user/search?username='+email, { auth: { username: email, password: jiratoken } });
                    jiraUser = userResponse.data[0].name;
                    jiraActive = userResponse.data[0].active;

                } catch(error) {
                    if(error.response.status == 404) {
                        logger.debug(error.response.status+" This Issue_Id: "+actualObj[i].issueId+" does not exist!");
                    } else {
                        logger.error(new Error(error.response.status+" Error"));
                    }
                }
            }
            if(issueArray.length != 0) {
                logger.debug("Got data from JIRA Project "+jiraProjectName);
                callback(projectkey, ownername, reponame, githubtoken, qtestusername, qtestdomain, qtestaccesstoken, dburl, accountname, issueArray, issuekeyArray, jiraProjectID, jiraProjectName, actualObj, octokit);
            }
            else {
                logger.error(new Error("Given wrong projectkey or scenario is not linked to the project"));
            }
        }    
    }
    else {
        logger.error(new Error("Something is wrong with config file "+filename));
    }
}
getValues(function(projectkey, ownername, reponame, githubtoken, qtestusername, qtestdomain, qtestaccesstoken, dburl, accountname, issueArray, issuekeyArray, jiraProjectID, jiraProjectName, actualObj, octokit) {
    
    projectkey = projectkey.toLowerCase();
    
    var deletefeatureFile = async function() {
        try {   
            octokit.authenticate({
                type: 'oauth',
                token: githubtoken
            });
    
            var result = await octokit.repos.getContent({owner: ownername, repo: reponame, path:'features/'+projectkey, ref: 'master'});
            for(var y=0; y<result.data.length; y++) {
                pathArray.push(result.data[y].path);
                delShaArray.push(result.data[y].sha);
            }
            if(result.meta.status == "200 OK") {
                for(var z=0; z<pathArray.length; z++) {
                    var res = await octokit.repos.deleteFile({owner: ownername, repo: reponame, path: pathArray[z], message: '[skip ci] Deleted features from '+projectkey+' folder', sha: delShaArray[z], branch: 'master'});
                }
                logger.debug("Deleted existing feature files inside features/"+projectkey+" folder from github enterprise");
            }
            else {
                logger.error(new Error("Couldn't retrieve commits from features/"+projectkey+" folder to delete existing feature files"));
            }
        }   catch(error) {
            logger.debug("There are no existing feature files inside features/"+projectkey+" folder");
        }
    }
        
    deletefeatureFile().then(function() {
        MongoClient.connect(dburl, function (err, client) {
            assert.equal(null, err);
            var db = client.db();
            var collection1 = db.collection('scenario-features');
            collection1.deleteMany({'projectId': jiraProjectID}, function(err) {
                assert.equal(null, err);
                logger.debug("Deleted all the existing documents related to "+projectkey+" inside mongodb scenario-accounts collection");
            });
            var collection2 = db.collection('scenario-projectsettings');
            collection2.deleteMany({'projectId': jiraProjectID}, function(err) { 
                assert.equal(null, err);
                logger.debug("Deleted all the existing documents related to "+projectkey+" inside mongodb scenario-projectsettings collection");
            });
            client.close();
        });
        getProjectID();
    });
    var getProjectID = async function() {
        for(var i=0; i<actualObj.length; i++) {
            for(var j=0; j<issueArray.length; j++) {
                if(actualObj[i].issueId == issueArray[j]) {
                    filterObj.push(actualObj[i]);
                }
            }
        }

        objFeature = filterObj.map(function(item){
            return {issueId : item["issueId"]}
        });

        for(var l=0; l<filterObj.length; l++) {
            var strArray = filterObj[l].content.split('\n');
            var str = "Feature: ";
            function searchStringInArray (str, strArray) {
                for (var k=0; k<strArray.length; k++) {
                    if (strArray[k].match(str)) return k;
                }
                return -1;
            }
            var x = searchStringInArray(str, strArray);
            var start = strArray[x].search(":");
            var end = strArray[x].length;
            nameArray.push(strArray[x].substring(start+2, end));
            normalizednameArray.push((strArray[x].substring(start+2, end)).toLowerCase());
        }

        for(var j=0; j<issueArray.length; j++) 
        {
            var features = "features/"+projectkey+"/"+nameArray[j]+"_"+issuekeyArray[j]+".feature";
            featurefolderArray.push(features);
        }
        
        for(var j=0; j<issueArray.length; j++) 
        {
            var feature = nameArray[j]+"_"+issuekeyArray[j]+".feature";
            featureArray.push(feature);
        }
        
        for(var g=0; g<filterObj.length; g++) {
            featuredataArray.push(Base64.encode(filterObj[g].content));
        }                

        octokit.authenticate({
            type: 'oauth',
            token: githubtoken
        });

        for(var x=0; x<filterObj.length; x++) {
            var result = await octokit.repos.createFile({owner: ownername, repo: reponame, path: featurefolderArray[x], message: '[skip ci] Created feature inside '+projectkey+' folder', content: featuredataArray[x], branch: 'master'});
        }
        if(result.meta.status == "201 Created") {
            logger.debug("Created feature files inside features/"+projectkey+" folder on "+reponame+" repository for github enterprise user "+ownername);
        }
        else {
            logger.error(new Error("Couldn't create feature files inside features/"+projectkey+" folder on "+reponame+" repository for github enterprise user "+ownername));
        }

        var commitresult = await octokit.repos.getCommits({owner: ownername, repo: reponame, path: 'features/'+projectkey, per_page: 10000});
        if(commitresult.meta.status == "200 OK") {
            for(var y=0; y<filterObj.length; y++) {
                reverseshaArray.push(commitresult.data[y].sha);
            }
            shaArray = reverseshaArray.reverse();
        }
        else {
            logger.error(new Error("Couldn't get commits from features folder on "+reponame+" repository for github user "+ownername));
        }

        var vcsresponse = await octokit.repos.get({owner: ownername, repo: reponame, path: 'features'});
        if(vcsresponse.meta.status == "200 OK") {
            vcsUrl = vcsresponse.data.html_url;
            vcsBranch = vcsresponse.data.default_branch;
            vcsPrivate = vcsresponse.data.private;
            vcsReponame = vcsresponse.data.full_name;
        }
        else {
            logger.error(new Error("Couldn't retrieve commits from features/"+projectkey+" folder on "+reponame+" repository for github enterprise user "+ownername));
        }

        var qTestresponse = await axios.get(qtestdomain+'/api/v3/users/search?username='+qtestusername, { headers: { Authorization: 'Bearer '+qtestaccesstoken}});   
        if(qTestresponse.status == 200) {
            isQtestAccountActive = true;
            qUsername = qtestusername;
            qDomain = qtestdomain;
            logger.debug(qtestusername+" account is active");
        }   else {
            isQtestAccountActive = false;
            logger.debug(qtestusername+" account is inactive");
        }
        
        var getAccountID = async function(callback) {
            MongoClient.connect(dburl, function (err, client) {
                assert.equal(null, err);
                var db = client.db();
                var collection1 = db.collection('scenario-accounts');
                collection1.find().toArray(function(err, accountResponse) {
                    assert.equal(err, null);
                    var m=0;
                    do {
                        if(accountResponse.length == 0 || accountResponse[m].clientKey != accountname) {
                            isAccount = true;         
                        }
                        else {
                            isAccount = false;
                            callback(accountResponse[m]._id);
                            client.close();
                        } 
                        m++;
                    }
                    while(m < accountResponse.length);
                    if(isAccount == true) {
                        // scenario-accounts document
                        objAccount.clientKey = accountname;
                        objAccount.createdAt = date.toISOString().slice(0, 23).replace('T', ' ');
                        objAccount.updatedAt = date.toISOString().slice(0, 23).replace('T', ' ');
                        objAccount.createdBy = jiraUser;
                        objAccount.type = 'jira';
                        objAccount.updatedBy = jiraUser;
                        objAccount.isActive = true;
                        
                        collection1.insertOne(objAccount, function (err, result) {
                            assert.equal(err, null);
                            callback(objAccount._id);
                            logger.debug("Inserted document related to "+accountname+" inside mongodb scenario-accounts collection");
                        });
                        client.close();                
                    }            
                });
            });
        }
        getAccountID(function(accountID) {
            for(var n=0; n<filterObj.length; n++) {
                // scenario-features document
                objFeature[n].accountId = accountID.toString();
                objFeature[n].issueKey = issuekeyArray[n];
                objFeature[n].projectId = jiraProjectID;
                objFeature[n].normalizedName = normalizednameArray[n];
                objFeature[n].name = nameArray[n];
                objFeature[n].fileName = featureArray[n];
                objFeature[n].sha = shaArray[n];
                objFeature[n].repoFullName = vcsReponame;
                objFeature[n].updatedBy = jiraUser;
                objFeature[n].isFeatureFileLinked = true;
                objFeature[n].isFeatureFileLocked = false;
                objFeature[n].createdAt = date.toISOString().slice(0, 23).replace('T', ' ');
                objFeature[n].updatedAt = date.toISOString().slice(0, 23).replace('T', ' ');       
            }
                            
            // scenario-projectsettings document
            objProject.accountId = accountID.toString();
            objProject.jira = {projectName: jiraProjectName};
            objProject.projectId = jiraProjectID;
            objProject.vcs = {url: vcsUrl, type: 'githubenterprise', branch: vcsBranch, featuresFolder: 'features/'+projectkey};
            objProject.updatedAt = date.toISOString().slice(0, 23).replace('T', ' ');
            objProject.updatedBy = jiraUser;
            objProject.createdAt = date.toISOString().slice(0, 23).replace('T', ' ');
            objProject.isQtestAccountActive = isQtestAccountActive;
            objProject.qtest = {username: qUsername, domain: qDomain};
            objProject.isVcsUrlPrivate = vcsPrivate; 

            MongoClient.connect(dburl, function (err, client) {
                assert.equal(null, err);
                var db = client.db();
                var collection2 = db.collection('scenario-features');
                // Insert some documents
                collection2.insertMany(objFeature, function (err, result) {
                    assert.equal(err, null);
                    logger.debug("Inserted documents related to "+projectkey+" and "+accountname+" inside mongodb scenario-features collection");
                });
                var collection3 = db.collection('scenario-projectsettings');
                // Insert some documents
                collection3.insertOne(objProject, function (err, result) {
                    assert.equal(err, null);
                    logger.debug("Inserted documents related to "+projectkey+" and "+accountname+" inside mongodb scenario-projectsettings collection"); 
                    logger.debug('The End!');
                });
                client.close();
            });
        });
    }         
});