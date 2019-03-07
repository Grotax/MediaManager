const electron = require('electron')
const {ipcMain, app, globalShortcut, BrowserWindow} = electron
const os = require('os')
const path = require('path')
const config = require(path.join(__dirname, 'package.json'))
const fs = require("fs")
const mime = require("mime")
const crypto = require("crypto")
const sharp = require('sharp');
// Datastore
const Datastore = require('nedb')

// dev: autoreload
//require('electron-reload')(__dirname);

//mainWindow.onbeforeunload = (e) => {
// Prevent Command-R from unloading the window contents.
//   e.returnValue = false
//}
//send error
//mainWindow.webContents.send("error:message", {type: "info", text:"oh boy"})

// Main window

app.setName(config.productName)
var mainWindow = null

app.on('ready', function () {
    
    // Get correct Position in multi-monitor setup
    const width = 1000;
    const height = 800;
    let bounds = electron.screen.getPrimaryDisplay().bounds;
    let x = Math.ceil(bounds.x + ((bounds.width - width) / 2));
    let y = Math.ceil(bounds.y + ((bounds.height - height) / 2));
    let db = null
    mimeTypes = ['image/jpeg', 'image/png']
    
    mainWindow = new BrowserWindow({
        x: x,
        y: y,
        width: width,
        height: height,
        backgroundColor: 'lightgray',
        title: config.productName,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            defaultEncoding: 'UTF-8'
        }
    })
    
    mainWindow.loadURL(`file://${__dirname}/index.html`)
    
    // Enable keyboard shortcuts for Developer Tools on various platforms.
    let platform = os.platform()
    if (platform === 'darwin') {
        globalShortcut.register('Command+Option+I', () => {
            mainWindow.webContents.openDevTools()
        })
    } else if (platform === 'linux' || platform === 'win32') {
        globalShortcut.register('Control+Shift+I', () => {
            mainWindow.webContents.openDevTools()
        })
    }
    
    mainWindow.once('ready-to-show', () => {
        mainWindow.setMenu(null)
        mainWindow.show()
    })
    
    // on close
    mainWindow.on('closed', function () {
        mainWindow = null
    })
    

    
    function mkdirSync(dirPath) {
        try {
            fs.mkdirSync(dirPath)
        } catch (err) {
            if (err.code !== 'EEXIST') throw err
        }
    }
    
    function createDB(collectionPath){
        db = new Datastore({
            filename: path.join(collectionPath, ".mediaManager", "mediamanager1.db"),
            autoload: true,
            onload: err =>{
                if(err){
                    console.log("Error: failed to load db ", err)
                }
            }
        });
        
    }
    
    //generate Thumbnail
    function thumbnail(id, filePath, mime) {
        return new Promise((resolve, reject) => {
            let baseDir = path.dirname(filePath)
            mkdirSync(path.join(baseDir, ".mediaManager"))
            let thumbnailDir = path.join(baseDir, ".mediaManager", "thumbnails")
            mkdirSync(thumbnailDir)
            let thumbnailName = path.join(thumbnailDir, id+".webp") 
            if(mime.includes("image")){
                sharp(filePath).resize(320, 240).toFile(thumbnailName, (err, info) => {
                    if(err){
                        reject(err)
                    }else{
                        resolve(thumbnailName)
                    }
                } );
            }else{
                reject("Unsupporteted")
            }
        })
    }
    // Hash File
    function fileHash(filename, algorithm = 'sha1') {
        return new Promise((resolve, reject) => {
            let shasum = crypto.createHash(algorithm);
            try {
                let s = fs.ReadStream(filename)
                s.on('data', function (data) {
                    shasum.update(data)
                })
                // making digest
                s.on('end', function () {
                    const hash = shasum.digest('hex')
                    return resolve(hash);
                })
            } catch (error) {
                return reject('calc fail');
            }
        });
    }
    
    // Add Medium to DB
    async function addMedium(filePath){
        return new Promise((resolve, reject) => {
            let mimeTypeFile = mime.getType(filePath)
            
            if(mimeTypes.includes(mimeTypeFile)){
                fileHash(filePath).then((id) => {
                    let title = path.posix.basename(filePath)
                    
                    thumbnail(id, filePath, mimeTypeFile).then((thumbnailDir) => {
                        let medium = {
                            _id: id,
                            title: title,
                            filePath: filePath,
                            thumbnail: thumbnailDir,
                            mime: mimeTypeFile,
                            tags: null,
                            created: new Date(),
                            last_modified: new Date()
                        };
                        // insert a medium
                        db.insert(medium, function (err, newMedium) {
                            if(err && err.errorType === "uniqueViolated"){
                                reject("uniqueViolated")
                            }
                            resolve(newMedium)
                        });
                    }).catch(function(rej) {
                        //here when you reject the 
                        console.log(rej);
                    });
                })
            }else{
                reject("unsupportedMIME")
            }
        });  
    }
    
    function checkDB(){
        db.find({}, function (err, media) {
            if(err){
                console.log("Can't find anything ", err)
            }else{
                media.forEach(medium => {
                    if (!fs.existsSync(medium.filePath)) {
                        db.remove({ _id: medium._id }, {}, function (err, numRemoved) {
                            if(err){
                                console.log("Can't delete from DB")
                            }else{
                                fs.unlinkSync(medium.thumbnail)
                                console.log("deleted something 1")
                            }
                        });
                        
                    }else{
                        fileHash(medium.filePath).then((computedID) => {
                            if(computedID !== medium._id){
                                db.remove({ _id: medium._id }, {}, function (err, numRemoved) {
                                    if(err){
                                        console.log("Can't delete from DB")
                                    }else{
                                        fs.unlinkSync(medium.thumbnail)
                                        console.log("deleted something")
                                    }
                                });
                            }
                        })
                    }
                });
            }
            
        });
    }
    
    async function scanDirectory(dir){
        let files = fs.readdirSync(dir)
        
        for (let i = 0, LEpath; LEpath = files[i]; i++) {
            try {
                fullPath = path.join(dir, LEpath)
                
                if(fs.lstatSync(fullPath).isDirectory()){
                    console.log("Ignore Directory")
                }else{
                    await addMedium(fullPath).then((newMedium) => {
                        console.log(newMedium._id)
                    }).catch(function(rej) {
                        //here when you reject the 
                        console.log(rej);
                    });
                }
            } catch (error) {
                console.log(error)
            }
        }
    }
    
    async function rescan(dir) {
        
        // check if db is in dir?
        if(db!== null){
            console.log("checkDB")
            await checkDB()
        }
        console.log("scanDir")
        await scanDirectory(dir)
        db.find({}, function (err, media) {
            if(err){
                console.log("Can't find anything ", err)
            }else{
                mainWindow.webContents.send("collection:rescan-done", media)
            }
            
        });
    }
    
    async function createCollection(dir){
        createDB(dir)
        await scanDirectory(dir)
        db.find({}, function (err, media) {
            if(err){
                console.log("Can't find anything ", err)
            }else{
                mainWindow.webContents.send("media:add", media)
            }
            
        });
    }
    
    /*
     * Update a Medium inside the collection.
     */
    function updateCollection(medium){
        db.update({ _id: medium._id }, { $set: { title: medium.title, tags: medium.tags, last_modified: new Date() } }, { returnUpdatedDocs: true }, function (err, numAffected, affectedDocuments, upsert) {
            console.log(affectedDocuments)
        });
    }

    Array.prototype.unique = function() {
        var a = this.concat();
        for(var i=0; i<a.length; ++i) {
            for(var j=i+1; j<a.length; ++j) {
                if(a[i] === a[j])
                a.splice(j--, 1);
            }
        }
        
        return a;
    };
    
    function search(searchString) {
        // Take out spaces and replace with pipes
        searchString = searchString.split(' ').join('|');
        
        // Use searchString to build rest of regex
        // -> Note: 'i' for case insensitive
        var regex = new RegExp(searchString, 'i');
        
        // Build query, using regex for each searchable field
        var query1 = {
            $and: [
                {
                    "title": {
                        "$regex": regex,
                    },
                },
                
                {
                    "tags": {
                        "$regex": regex,
                    },
                },
            ]
        };
        var query2 = {
            $or: [
                {
                    "title": {
                        "$regex": regex,
                    },
                },
                
                {
                    "tags": {
                        "$regex": regex,
                    },
                },
            ]
        };
        result1 = null
        result2 = null

        db.find(query1, function (err, media) {
            if(err){
                console.log("Can't find anything ", err)
            }else{
                result1 = media
                db.find(query2, function (err, media) {
                    if(err){
                        console.log("Can't find anything ", err)
                    }else{
                        result2 = media
                        mainWindow.webContents.send("search:result", [...result1, ...result2])
                    }
                });
            }
        });
    }
    
    //send Media here
    ipcMain.on('mainWindowLoaded', function(){
        if(db!== null){
            db.find({}, function (err, media) {
                mainWindow.webContents.send("medium:add", media)
            });
        }
    })   

    ipcMain.on('search:request', function(e, searchString){
        search(searchString)
    })

    ipcMain.on("collection:create", function(e, directory){
        createCollection(directory[0])
    })

    ipcMain.on("collection:rescan", (e, dir) =>{
        console.log(dir)
        rescan(dir)
    })

    ipcMain.on("collection:update", (e, medium) =>{
        updateCollection(medium)
    })
})

app.on('window-all-closed', () => { app.quit() })