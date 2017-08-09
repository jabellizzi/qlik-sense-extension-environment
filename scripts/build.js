const 
  fs = require('fs-extra'),
  path = require('path'),
  webpack = require('webpack'),
  Rx = require('rxjs'),
  RxQ = require('rxq'),
  zipdir = require('zip-dir'),
  serverConfig = require('./server.config.json');

// Get Inputs
const args = process.argv.slice(2);
const chartName = args[0];


// =========== Observables ===========
// Create subject
const chart$ = new Rx.Subject();

// Create Observable
const bundle$ = chart$
  // Check --watch and --deploy
  .map(m => {
    return {
      watch: m.indexOf('--watch') != -1,
      deploy: m.indexOf('--deploy') != -1,
      chartName: m[0]
    }
  })
  .mergeMap(o => new BundleObservable(o))
  .mergeMap(o => new CopyQEXT(o))
  .mergeMap(o => new ZipFiles(o))
  .publish();

// Connect to bundle$
bundle$.connect();

const deploy$ = bundle$
  .filter(f => f.deploy)
  .mergeMap(o => new DeployObservable(o))
  .subscribe();

// =========== Trigger Observables ===========
// if name supplied..
if(typeof chartName != 'undefined'){
  // Try to connect to directory
  fs.stat(`chart/${chartName}`, function(err, stats){
    if(err) console.log("directory doesn't exist");
    else if(stats.isDirectory()) chart$.next(args);
  })
}
// else if name not supplied
else console.log('Chart must be specified');


// =========== Functions ===========
/* Bundle incoming files using weback. 
    If in --watch mode, watch for changes.
    Rename js file to input name */
function BundleObservable(chart){
  // console.log(chart);
  return Rx.Observable.create(observer =>{
    // Create webpack compiler
    const compiler = webpack({
      entry: [`./chart/${chart.chartName}/index.js`],
      output: {
        path: path.resolve(__dirname, `../dist/${chart.chartName}`),
        filename: `${chart.chartName}.js`
      },
      module: {
        loaders: [
          {
            test: /\.js$/,
            exclude: /node_modules/,
            loader: 'babel-loader'
          }
        ]
      }
    });

    
    if(chart.watch){
      compiler.watch({}, (err, stats) =>{
        console.log('[webpack:build]', stats.toString({colors: true}));
        observer.next(chart)
      })
    }
    else{
      compiler.run((err, stats) =>{
        console.log("[webpack:build]", stats.toString({colors: true}));
        observer.next(chart);
        observer.complete();
      })
    }
  })
}


/* Copy QEXT file and rename to input name */
function CopyQEXT(chart){
  return Rx.Observable.create(observer =>{
    const readStream = fs.createReadStream(`./chart/${chart.chartName}/index.qext`);
    const writeStream = fs.createWriteStream(`./dist/${chart.chartName}/${chart.chartName}.qext`);
    readStream.pipe(writeStream);
    
    observer.next(chart);
    observer.complete();
  })
}


/* Zip file */
function ZipFiles(chart){
  return Rx.Observable.create(function(observer){
    // Define output of .zip file
    const outputDir = './dist';
    // Define input directory to be zipped
    const inputDir = outputDir +'/' +chart.chartName;

    zipdir(inputDir, 
      {saveTo: outputDir +'/' +chart.chartName +'.zip'}, 
      function(err, buffer){
        observer.next(chart);
        observer.complete();
      });
  });
}


/* Deploy to server */
function DeployObservable(chart){
  const qrs = RxQ.connectQRS(serverConfig, 'cold');

  return new DeleteExtensionObservable(qrs, chart)
    .mergeMap(o => new UploadExtensionObservable(qrs, o));
};


/* Delete current extension */
function DeleteExtensionObservable(qrs, chart){
  return Rx.Observable.create(function(observer){
    const options = {
      "method": "DELETE",
      "hostname": "jbellizzi.dev",
      "port": null,
      "path": "hdr/qrs/extension/name/" + chart.chartName + "?Xrfkey=123456789ABCDEFG",
      "headers": {
        "x-qlik-xrfkey": "123456789ABCDEFG",
        "hdr-usr": "win-0tss6c5nd86\\administrator",
        "content-type": "application/zip",
        "cache-control": "no-cache",
        "postman-token": "f22f9610-ec3a-45a5-b291-1de45e3d0cf1"
      }
    };

    const http = qrs.http;

    const req = http.request(options, function(res){
      var chunks = [];

      res.on('data', chunk => chunks.push(chunk));

      res.on('error', err => {});

      res.on('end', e =>{
        rawData = chunks.join('');
        var data;

        try{
          data = JSON.parse(rawData);
        } catch(err){
          data = rawData;
        }
        observer.next(chart);
        observer.complete();
      });
    });

    req.end();
  })
}


/* Upload extension */
function UploadExtensionObservable(qrs, chart){
  return Rx.Observable.create(function(observer){
    const chartPath = `./dist/${chart.chartName}.zip`;

    const options = {
      "method": "POST",
      "hostname": "jbellizzi.dev",
      "port": null,
      "path": "hdr/qrs/extension/upload?Xrfkey=123456789ABCDEFG",
      "headers": {
        "x-qlik-xrfkey": "123456789ABCDEFG",
        "hdr-usr": "win-0tss6c5nd86\\administrator",
        "content-type": "application/zip",
        "cache-control": "no-cache",
        "postman-token": "f22f9610-ec3a-45a5-b291-1de45e3d0cf1"
      }
    };

    const http = qrs.http;

    const POST_DATA = fs.readFileSync(chartPath);

    const req = http.request(options, res =>{
      var chunks = [];

      res.on('data', chunk => chunks.push(chunk));

      res.on('end', () =>{
        const body = Buffer.concat(chunks);
        observer.next(chart);
        observer.complete();
      });
    });

    req.write(POST_DATA);
    req.end();
  })
}