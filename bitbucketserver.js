var Pool = require('pg').Pool;
var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');
var axios = require('axios');
var request = require('request');
var fs = require('fs');
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var Base64 = require('js-base64').Base64;
var xhr = new XMLHttpRequest();

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
var sortedIssueArray = [];
var issuekeyArray = [];
var featureArray = [];
var featurefolderArray = [];
var featuredataArray = [];
var sortedfeatureIDArray = [];
var nameArray = [];
var normalizednameArray = [];
var clientkeyArray = [];
var obj = {};
var objAccount = {};
var objFeature = {};
var objProject = {};
var shaArray = [];
var reverseshaArray = [];
var date = new Date();
var isQtestAccountActive;
var qUsername;
var qDomain;
var vcsUrl;
var vcsPrivate;
var vcsName;
var vcsProjectKey;
var jiraProjectID;
var jiraProjectName;
var jiraUser;
var jiraActive;

var filename = "./bitbucketserver-config.json";
var getValues = async function(callback) {
    logger.debug("Script started running!");
    var filedata = fs.readFileSync(filename, 'utf8');
    var jsonObj = JSON.parse(filedata);

    if(jsonObj !== null && typeof jsonObj === 'object') {
        var url = jsonObj.jirausername;
        var email = jsonObj.jiraemail;
        var jiratoken = jsonObj.jiraaccesstoken;
        var projectkey = jsonObj.jiraprojectkey;
    
        var bitbucketowner = jsonObj.bitbucketusername;
        var reponame = jsonObj.bitbucketreponame;
        var bitbucketpassword = jsonObj.bitbucketpassword;
        var bitbucketurl = jsonObj.bitbucketurl;
        var authString = bitbucketowner+':'+bitbucketpassword;
    
        var qtestusername = jsonObj.qtestusername;
        var qtestdomain = jsonObj.qtestdomain;
        var qtestaccesstoken = jsonObj.qtestaccesstoken;
    
        var pghostname = jsonObj.pghostname;
        var pgusername = jsonObj.pgusername;
        var pgpassword = jsonObj.pgpassword;
        var pgdbname = jsonObj.pgdbname;
        var accountname = jsonObj.accountname;
            
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
                        logger.debug(new Error(error.response.status+" Error"));
                    }
                }
            }
            if(issueArray.length != 0) {
                logger.debug("Got data from JIRA Project "+jiraProjectName);
                callback(projectkey, bitbucketowner, reponame, bitbucketpassword, bitbucketurl, authString, qtestusername, qtestdomain, qtestaccesstoken, dburl, accountname, issueArray, issuekeyArray, jiraProjectID, jiraProjectName, jiraUser, jiraActive, actualObj);
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
getValues(function(projectkey, bitbucketowner, reponame, bitbucketpassword, bitbucketurl, authString, qtestusername, qtestdomain, qtestaccesstoken, dburl, accountname, issueArray, issuekeyArray, jiraProjectID, jiraProjectName, jiraUser, jiraActive, actualObj) {
    
    projectkey = projectkey.toLowerCase();

    MongoClient.connect(dburl, function (err, client) {
        assert.equal(null, err);
        var db = client.db();
        var collection1 = db.collection('scenario-features');
        collection1.deleteMany({'projectId': jiraProjectID}, function(err) {
            assert.equal(null, err);
            logger.debug("Deleted the existing documents related to "+projectkey+" inside mongodb scenario-accounts collection");
        });
        var collection2 = db.collection('scenario-projectsettings');
        collection2.deleteMany({'projectId': jiraProjectID}, function(err) { 
            assert.equal(null, err);
            logger.debug("Deleted the existing documents related to "+projectkey+" inside mongodb scenario-projectsettings collection");
        });
        client.close();
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
            featuredataArray.push(filterObj[g].content);
        }

        var urlResponse = await axios.get(bitbucketurl+'/rest/api/1.0/repos/', { headers: { Authorization: 'Basic ' + Base64.encode(authString)}});
        for(var i=0; i < urlResponse.data.values.length; i++) {
            if(urlResponse.data.values[i].name == reponame) {
                vcsProjectKey = urlResponse.data.values[i].project.key;
                vcsUrl = urlResponse.data.values[i].links.clone[i].href;
                vcsName = urlResponse.data.values[i].name;
                vcsPrivate = urlResponse.data.values[i].public;
            }
        }

        for(var i=0; i<featurefolderArray.length; i++) {
            var url = bitbucketurl+'/rest/api/1.0/projects/'+vcsProjectKey+'/repos/'+reponame+'/raw/'+featurefolderArray[i];
            xhr.open('GET', url, false);
            xhr.setRequestHeader('Authorization', 'Basic ' + Base64.encode(authString));
            xhr.send();
            if(xhr.status == 200) {
            }
            else if(xhr.status == 404 ) {
                sortedfeatureIDArray.push(i);
            }
        }

        var getRequest =  async function() {
            for(var i=0; i<sortedfeatureIDArray.length; i++) {   
                await new Promise(function (resolve, reject) {
                    var options = {
                        method: 'PUT',
                        url: bitbucketurl+'/rest/api/1.0/projects/'+vcsProjectKey+'/repos/'+reponame+'/browse/'+featurefolderArray[sortedfeatureIDArray[i]],
                        auth: {
                            user: bitbucketowner,
                            password: bitbucketpassword
                        }
                    }
                    var req = request(options, function (error, res, body) {
                    if (!error && res.statusCode == 201 || res.statusCode == 200) {
                        resolve();
                    } 
                    else {
                        reject();
                        logger.debug(res.statusCode+ " and "+error+ " and "+featurefolderArray[sortedfeatureIDArray[i]]);
                    }
                    });
                    var form = req.form(); 
                    form.append('message', '[skip ci] Created feature inside '+projectkey+' folder');
                    form.append('author', bitbucketowner);
                    form.append('branch', 'master');
                    form.append('content',featuredataArray[[sortedfeatureIDArray[i]]]);
                });    
            }
        }    
        var myfunc = getRequest();
        myfunc.then(async function () {
            logger.debug("Created Feature files inside features/"+projectkey+" folder on "+reponame+" repository for bitbucket server user "+bitbucketowner);

            var commitResponse = await axios.get(bitbucketurl+'/rest/api/1.0/projects/'+vcsProjectKey+'/repos/'+reponame+'/commits?limit=10000', { headers: { Authorization: 'Basic ' + Base64.encode(authString)}});
            if(commitResponse.status == 200) {
                for(var j=0; j<featureArray.length; j++) {
                    reverseshaArray.push(commitResponse.data.values[j].id);
                }
                shaArray = reverseshaArray.reverse();
            }
            else {
                logger.error(new Error("Couldn't retrieve commits from features/"+projectkey+" folder on "+reponame+" repository for bitbucket server user "+bitbucketowner));
            }

            var qTestResponse = await axios.get(qtestdomain+'/api/v3/users/search?username='+qtestusername, { headers: { Authorization: 'Bearer '+qtestaccesstoken}});   
            if(qTestResponse.status == 200) {
                isQtestAccountActive = true;
                qUsername = qtestusername;
                qDomain = qtestdomain;
                logger.debug(qtestusername+" account is active");
            }   else {
                isQtestAccountActive = false;
                logger.debug(qtestusername+" account is inactive");
            }
            storeData();
        }).catch(function () {
            logger.error(new Error("Feature Files are not created in the "+reponame+" repository for bitbucket server user "+bitbucketowner));
        });

        var storeData = function() {
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
                            objAccount.isActive = jiraActive;
                            
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
                    objFeature[n].repoFullName = vcsProjectKey.toLowerCase()+'/'+reponame;
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
                objProject.vcs = {url: vcsUrl, type: 'bitbucketserver', branch: 'master', featuresFolder: 'features/'+projectkey, username: bitbucketowner, password: bitbucketpassword};
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
                    collection2.insertMany(objFeature, function (err, result) {
                        assert.equal(err, null);
                        logger.debug("Inserted documents related to "+projectkey+" and "+accountname+" inside mongodb scenario-features collection");
                    });
                    var collection3 = db.collection('scenario-projectsettings');
                    collection3.insertOne(objProject, function (err, result) {
                        assert.equal(err, null);
                        logger.debug("Inserted documents related to "+projectkey+" and "+accountname+" inside mongodb scenario-projectsettings collection");  
                        logger.debug('The End!');
                    });
                    client.close();
                });
            }); 
        }
    }
});