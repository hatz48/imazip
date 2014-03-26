/// <reference path="../d.ts/DefinitelyTyped/jquery/jquery.d.ts" />

declare var chrome:any;
declare var Promise:any;
declare var JSZip:any;
declare var URI:any;

chrome.browserAction.setBadgeBackgroundColor({ color: '#00FF00' });

chrome.browserAction.onClicked.addListener(function() {

    chrome.tabs.query({active:true}, function(tabs) {
        var tab = tabs[0];

        new Promise(function(resolve, reject) {
            chrome.browserAction.getBadgeText(
                { tabId : tab.id },
                function(badgeText) { resolve(badgeText) }
            );
        }).then(function(badgeText) {
            if (badgeText === 'on') {
                chrome.tabs.sendMessage(tab.id, {command:'imazip:end'});
                chrome.browserAction.setBadgeText({ tabId: tab.id, text: '' })
            } else {
                chrome.tabs.executeScript(tab.id, {file: "js/jquery-2.0.3.js"});
                chrome.tabs.executeScript(tab.id, {file: "js/pick-url.js"}, function(result) {
                    chrome.tabs.sendMessage(tab.id, {
                        command:'imazip:start',
                        filter: localStorage['filters']
                    });
                });
                chrome.browserAction.setBadgeText({ tabId: tab.id, text: 'on' })
            }
        });
    });
});

chrome.runtime.onMessage.addListener(function(req, sender, sendResponse) {
    if (req.name === 'imazip:url:picked') {
        var pageUrl = sender.url;
        var urls    = req.urls;

        // このページに適用するコンバータのみ取り出す
        var convertersForSenderPage =
            converters.filter((c) => !!pageUrl.match(c.pageUrl.regexp))
                      .map((c) => c.filterScript);

        // コンバータを適用する
        var promise = convertersForSenderPage.reduce(
            (promise:JQueryPromise<any>, converter) => {
                return promise.then((...urls) => {
                    return $.when.apply($, converter(urls));
                });
            },
            $.when.apply($, urls)
        );

        // 全てのコンバータが適用されたら、画像の url を取り出しベージを開く
        promise.then((...urls:any[]) => {
            var imageUrls = urls.filter((urlSet) => urlSet.url ? true : false)
                                .map((urlSet):string => urlSet.url);

            chrome.browserAction.setBadgeText({ tabId: sender.tab.id, text: '' });
            chrome.tabs.create({url:"html/download.html"}, function(tab) {
                chrome.tabs.sendMessage(tab.id, {urls:imageUrls, title:req.title});
            });
        });

    }

    if (req.name !== 'imazip') return;
    var page_url = req.page_url;
    var urls     = req.urls;
    var filename = req.filename.replace(/[:\/|"*<>?]/g, '');
    filename += filename.match(/\.zip$/) ? '' : '.zip';

    var zip = new JSZip();

    var promises = urls.map(function (url) {
        var resolvedUrl = URI.resolve(page_url, url);
        return new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", resolvedUrl);
            xhr.responseType = "arraybuffer";

            xhr.onload = function (event) {
                var arrayBuffer = xhr.response;
                var filename = resolvedUrl.replace(/^(.*)\//, '');
                var mime = xhr.getResponseHeader('Content-Type');
                var ext  = mimeTypes[mime];
                filename += filename.match(new RegExp('\\.' + ext + '$')) ? '' : '.' + ext;
                zip.file(filename, arrayBuffer, { binary : true });
                resolve(true);
            };
            xhr.onerror = function (event) {
                resolve(false);
            };
            xhr.send();
        });
    });

    Promise.all(promises).then(function () {
        var blob = zip.generate({ type: "blob" });
        var objectUrl = URL.createObjectURL(blob);

        chrome.downloads.download({
            url:objectUrl,
            filename:filename
        }, function() {
            console.log('complete');
            sendResponse('complete');
        })
    });
});

var converters = [
    // {
    //     pageUrl: { regexp: /.*/ },
    //     filterScript: (urlsWithImages:any[]):any[] => {
    //         return urlsWithImages.filter((image) => {
    //             var img = image.img;
    //             return (img.width >= 90 && img.height >= 90) ? true : false;
    //         });
    //     },
    // },
    {
        pageUrl: { regexp: /.*/ },
        filterScript: (urls:any[]):any[] => {
            return urls.map((urlSet) => {
                if (!urlSet.srcUrl) return;
                var url = urlSet.anchorUrl && urlSet.anchorUrl.match(/(jpeg|jpg|png|gif)$/i)
                    ? urlSet.anchorUrl : urlSet.srcUrl;
                return {
                    anchorUrl : urlSet.anchorUrl,
                    srcUrl    : urlSet.srcUrl,
                    url       : url,
                };
            });
        }
    },
    // {
    //     pageUrl: { regexp : /g.e-hentai.org/ },
    //     filterScript: function (urlsWithImages) {
    //         return urlsWithImages.map(function (urlWithImage) {
    //             var img = urlWithImage.img;
    //             var $img = $(img);
    //             var $a = $img.closest('a');
    //             var href = $a.attr('href');
    //             var pageUrl = $a.attr('href');
    //             var d = $.Deferred();
    //             $.get(pageUrl).done(function (body) {
    //                 var url = $(body).find('#img').attr('src');
    //                 d.resolve({ url: url, img: img });
    //             });
    //             return d.promise();
    //         });
    //     }
    // },
    {
        pageUrl: { regexp : /matome.naver.jp/ },
        filterScript: function (urls) {
            return urls.map(function (urlSet) {
                var pageUrl = urlSet.anchorUrl;
                var d = $.Deferred();
                $.get(pageUrl).done(function (body) {
                    var url = $(body).find('.mdMTMEnd01Wrap img').attr('src');
                    d.resolve({
                        anchorUrl : urlSet.anchorUrl,
                        srcUrl    : urlSet.srcUrl,
                        url       : url,
                    });
                }).fail(function(body) {
                    d.resolve({
                        anchorUrl : urlSet.anchorUrl,
                        srcUrl    : urlSet.srcUrl,
                    });
                });
                return d.promise();
            });
        }
    },
    // {
    //     pageUrl: { regexp : /^http:\/\/www.cosp.jp/ },
    //     filterScript: (urlsWithImages:any[]):any[] => {
    //         return urlsWithImages.map((urlWithImage) => {
    //             var img = urlWithImage.img;
    //             var $img = $(img);
    //             var $a = $img.closest('a');
    //             var href = $a.attr('href');
    //             if (!href || href[0] !== '/') return urlWithImage;
    //             var pageUrl = 'http://www.cosp.jp' + $a.attr('href');
    //             var d = $.Deferred();
    //             $.get(pageUrl).done((body) => {
    //                 var url = $(body).find('#imgView').attr('src');
    //                 // console.log(url)
    //                 d.resolve({ url : url, img : img });
    //             })
    //             return d.promise();
    //         });
    //     },
    // }
];

var mimeTypes = {
    'image/bmp'                      : 'bmp',
    'image/cgm'                      : 'cgm',
    'image/g3fax'                    : 'g3',
    'image/gif'                      : 'gif',
    'image/ief'                      : 'ief',
    'image/jpeg'                     : 'jpg',
    'image/ktx'                      : 'ktx',
    'image/png'                      : 'png',
    'image/prs.btif'                 : 'btif',
    'image/sgi'                      : 'sgi',
    'image/svg+xml'                  : 'svg',
    'image/tiff'                     : 'tiff',
    'image/vnd.adobe.photoshop'      : 'psd',
    'image/vnd.dece.graphic'         : 'uvi',
    'image/vnd.dvb.subtitle'         : 'sub',
    'image/vnd.djvu'                 : 'djvu',
    'image/vnd.dwg'                  : 'dwg',
    'image/vnd.dxf'                  : 'dxf',
    'image/vnd.fastbidsheet'         : 'fbs',
    'image/vnd.fpx'                  : 'fpx',
    'image/vnd.fst'                  : 'fst',
    'image/vnd.fujixerox.edmics-mmr' : 'mmr',
    'image/vnd.fujixerox.edmics-rlc' : 'rlc',
    'image/vnd.ms-modi'              : 'mdi',
    'image/vnd.ms-photo'             : 'wdp',
    'image/vnd.net-fpx'              : 'npx',
    'image/vnd.wap.wbmp'             : 'wbmp',
    'image/vnd.xiff'                 : 'xif',
    'image/webp'                     : 'webp',
    'image/x-3ds'                    : '3ds',
    'image/x-cmu-raster'             : 'ras',
    'image/x-cmx'                    : 'cmx',
    'image/x-freehand'               : 'fh',
    'image/x-icon'                   : 'ico',
    'image/x-mrsid-image'            : 'sid',
    'image/x-pcx'                    : 'pcx',
    'image/x-pict'                   : 'pic',
    'image/x-portable-anymap'        : 'pnm',
    'image/x-portable-bitmap'        : 'pbm',
    'image/x-portable-graymap'       : 'pgm',
    'image/x-portable-pixmap'        : 'ppm',
    'image/x-rgb'                    : 'rgb',
    'image/x-tga'                    : 'tga',
    'image/x-xbitmap'                : 'xbm',
    'image/x-xpixmap'                : 'xpm',
    'image/x-xwindowdump'            : 'xwd'
}