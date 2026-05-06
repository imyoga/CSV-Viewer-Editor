importScripts('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js')

self.onmessage = function (e) {
  var blob = e.data.blob
  var chunkIndex = e.data.chunkIndex

  Papa.parse(blob, {
    header: false,
    skipEmptyLines: false,
    complete: function (result) {
      self.postMessage({ data: result.data, errors: result.errors, chunkIndex: chunkIndex })
    },
    error: function (err) {
      self.postMessage({ error: err.message, chunkIndex: chunkIndex })
    },
  })
}
