var Pool = require('pg').Pool;
var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');
var axios = require('axios');
var request = require('request');
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
var sortedIssueArray = [];
var issuekeyArray = [];
var jiraUser;
var jiraActive;
var featureArray = [];
var featurefolderArray = [];
var featuredataArray = [];
var nameArray = [];
var normalizednameArray = [];
var clientkeyArray = [];
var objAccount = {};
var objFeature = {};
var objProject = {};
var mongoResponse;
var sampleResponse;
var shaArray = [];
var reverseshaArray = [];
var urlArray = [];
var date = new Date();
var isQtestAccountActive;
var qUsername;
var qDomain;
var vcsPrivate;
var vcsUrl;
var vcsReponame;
var jiraProjectID;
var jiraProjectName;

var filename = "./bitbucketcloud-config.json";
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
    
        var qtestusername = jsonObj.qtestusername;
        var qtestdomain = jsonObj.qtestdomain;
        var qtestaccesstoken = jsonObj.qtestaccesstoken;
    
        var pghostname = jsonObj.pghostname;
        var pgusername = jsonObj.pgusername;
        var pgpassword = jsonObj.pgpassword;
        var pgdbname = jsonObj.pgdbname;
        var accountname = jsonObj.accountname
            
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
                        logger.debug("Status: "+error.response.status+" "+error.response.statusText+ " This Issue_Id: "+actualObj[i].issueId+" does not exist!");
                    } else {
                        logger.debug("Something went wrong!", error);
                    }
                }
            }
            if(issueArray.length != 0) {
                logger.debug("Got data from JIRA Project "+projectkey+":"+jiraProjectID+":"+jiraProjectName);
                callback(projectkey, bitbucketowner, reponame, bitbucketpassword, qtestusername, qtestdomain, qtestaccesstoken, dburl, accountname, issueArray, issuekeyArray, jiraProjectID, jiraProjectName, actualObj);
            }
            else {
                logger.error("Given wrong projectkey or scenario is not linked to project key");
            }
        }     
    }
    else {
        logger.error(new Error("Something wrong with json file!"));
    }
}
getValues(function(projectkey, bitbucketowner, reponame, bitbucketpassword, qtestusername, qtestdomain, qtestaccesstoken, dburl, accountname, issueArray, issuekeyArray, jiraProjectID, jiraProjectName, actualObj) {

    projectkey = projectkey.toLowerCase();

    MongoClient.connect(dburl, function (err, client) {
        assert.equal(null, err);
        var db = client.db();
        var collection1 = db.collection('scenario-features');
        collection1.deleteMany({'projectId': jiraProjectID}, function(err) {
            assert.equal(null, err);
            logger.debug("Deleted all the existing documents in scenario-accounts collection");
        });
        var collection2 = db.collection('scenario-projectsettings');
        collection2.deleteMany({'projectId': jiraProjectID}, function(err) { 
            assert.equal(null, err);
            logger.debug("Deleted all the existing documents in scenario-projectsettings collection");
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

        var createFile =  async function() {
            for(var i=0; i<featureArray.length; i++) {    
                await new Promise(function (resolve, reject) {
                    var options = {
                        url: 'https://api.bitbucket.org/2.0/repositories/'+bitbucketowner+'/'+reponame+'/src/',
                        auth: {
                            user: bitbucketowner,
                            password: bitbucketpassword
                        }
                    }
                    var req = request.post(options, function (error, res, body) {
                    if (!error && res.statusCode == 201 || res.statusCode == 200) {
                        logger.debug(res.statusCode+" and "+featureArray[i]);
                        resolve();
                    } else {
                        reject();
                        logger.error(res.statusCode+ " and "+error+ " and "+featureArray[i]);
                    }
                    });
                    var form = req.form(); 
                    form.append('message', '[skip ci] Create feature');
                    form.append('author', 'Hari Kiran Yalavarthi<harikiranyalavarthi9@gmail.com>');
                    form.append('branch', 'master');
                    form.append(featurefolderArray[i],featuredataArray[i], { filename: featureArray[i]});
                });
            }
        }
        var myfunc = createFile();
        myfunc.then(async function () {
            logger.debug("Created Feature files in features folder on "+reponame+" repository for bitbucket user "+bitbucketowner);
            var i = featureArray.length/30;
            var j = Math.ceil(i);
            var k = 1;
            while(k<=j) {
                var vcsresponse = await axios.get('https://api.bitbucket.org/2.0/repositories/'+bitbucketowner+'/'+reponame+'/commits?page='+k, { auth: { username: bitbucketowner, password: bitbucketpassword } });
                if(vcsresponse.status == 200) {
                    for(p=0; p<vcsresponse.data.values.length; p++) {
                        if(reverseshaArray.length < featureArray.length) { 
                            reverseshaArray.push(vcsresponse.data.values[p].hash);
                            vcsUrl = vcsresponse.data.values[p].repository.links.html.href;
                            vcsReponame = vcsresponse.data.values[p].repository.full_name;
                        }
                    }
                    k++;
                }
                else {
                    logger.error(new Error("Couldn't get commits, url and reponame from features folder on "+reponame+" repository for bitbucket server user "+bitbucketowner));
                }
            }
            shaArray = reverseshaArray.reverse();

            var privateresponse = await axios.get('https://api.bitbucket.org/2.0/repositories/'+bitbucketowner+'/'+reponame, { auth: { username: bitbucketowner, password: bitbucketpassword } });
            if(privateresponse.status == 200) {
                vcsPrivate = privateresponse.data.is_private;
            }   
            else {
                logger.error(new Error("Couldn't get vcsPrivate information from features folder on "+reponame+" repository for bitbucket server user "+bitbucketowner));
            }
            
            var qTestresponse = await axios.get(qtestdomain+'/api/v3/users/search?username='+qtestusername, { headers: { Authorization: 'Bearer '+qtestaccesstoken}});   
            if(qTestresponse.status == 200) {
                isQtestAccountActive = true;
                qUsername = qtestusername;
                qDomain = qtestdomain;
            }   else {
                isQtestAccountActive = false;
            }
            storeData();
        }).catch(function () {
            logger.error(new Error("Feature Files are not created in the repository "));
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
                            objAccount.isActive = true;
                            
                            collection1.insertOne(objAccount, function (err, result) {
                                assert.equal(err, null);
                                callback(objAccount._id);
                                logger.debug("Inserted document into the scenario-accounts collection with id "+accountname);
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
                objProject.vcs = {url: vcsUrl, type: 'bitbucketcloud', branch: 'master', featuresFolder: 'features/'+projectkey};
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
                        logger.debug("Inserted documents into the scenario-features collection with id "+accountname);
                    });
                    var collection3 = db.collection('scenario-projectsettings');
                    // Insert some documents
                    collection3.insertOne(objProject, function (err, result) {
                        assert.equal(err, null);
                        logger.debug("Inserted documents into the scenario-projectsettings collection with id "+accountname); 
                        logger.debug('The End!');
                    });
                    client.close();
                });
            }); 
        }
    }
});
