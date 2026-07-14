// Virtual scroll: render only visible rows for tables with many rows
const VIRTUAL_SCROLL_THRESHOLD = 2000 // rows
const ROW_HEIGHT = 28                 // px — must match CSS td height
const OVERSCAN = 30                   // extra rows above/below viewport
const MULTI_WORKER_MIN_SIZE = 5 * 1024 * 1024 // 5 MB threshold for parallel parsing

function escapeHTML(val) {
	const s = val == null ? '' : String(val)
	// Fast path: most cells contain no special chars
	if (!/[&<>]/.test(s)) return s
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

class CSVEditor {
	constructor() {
		this.csvData = []
		this.originalCsvData = []
		this.fileName = ''
		this.isEdited = false
		this.editedCells = new Set()

		// Virtual scroll state
		this._tbody = null
		this._numCols = 0
		this._vsEnabled = false
		this._vsStart = 0
		this._vsEnd = 0
		this._vsScrollHandler = null
		this._vsRafPending = false

		this.initializeElements()
		this.bindEvents()
	}

	initializeElements() {
		this.fileInput = document.getElementById('csvFile')
		this.pasteBtn = document.getElementById('pasteBtn')
		this.saveBtn = document.getElementById('saveBtn')
		this.resetBtn = document.getElementById('resetBtn')
		this.tableContainer = document.getElementById('tableContainer')
		this.fileNameSpan = document.getElementById('fileName')
		this.rowCountSpan = document.getElementById('rowCount')
		this.progressOverlay = document.getElementById('progressOverlay')
		this.progressText = document.getElementById('progressText')
		this.progressPercent = document.getElementById('progressPercent')
		this.progressFill = document.getElementById('progressFill')
		this.progressDetails = document.getElementById('progressDetails')
		this.pasteOverlay = document.getElementById('pasteOverlay')
		this.pasteTextarea = document.getElementById('pasteTextarea')
		this.pasteLoadBtn = document.getElementById('pasteLoadBtn')
		this.pasteCancelBtn = document.getElementById('pasteCancelBtn')
		this.pasteCloseBtn = document.getElementById('pasteCloseBtn')
	}

	bindEvents() {
		this.fileInput.addEventListener('change', (e) => {
			const file = e.target.files[0]
			if (file) this.processFile(file)
		})
		this.pasteBtn.addEventListener('click', () => this.openPasteModal())
		this.pasteLoadBtn.addEventListener('click', () => this.loadPastedCSV())
		this.pasteCancelBtn.addEventListener('click', () => this.closePasteModal())
		this.pasteCloseBtn.addEventListener('click', () => this.closePasteModal())
		this.pasteOverlay.addEventListener('click', (e) => {
			if (e.target === this.pasteOverlay) this.closePasteModal()
		})
		this.saveBtn.addEventListener('click', () => this.saveCSV())
		this.resetBtn.addEventListener('click', () => this.resetChanges())

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && !this.pasteOverlay.classList.contains('hidden')) {
				this.closePasteModal()
				return
			}
			if (e.ctrlKey && e.key === 's') {
				e.preventDefault()
				if (!this.saveBtn.disabled) this.saveCSV()
			} else if (e.ctrlKey && e.key === 'r') {
				e.preventDefault()
				if (!this.resetBtn.disabled) this.resetChanges()
			}
		})

		this._setupDragDrop()
		this._setupPlaceholderActions()
	}

	_setupPlaceholderActions() {
		this.tableContainer.addEventListener('click', (e) => {
			const link = e.target.closest('.placeholder-link')
			if (!link) return
			const action = link.dataset.action
			if (action === 'upload') this.fileInput.click()
			else if (action === 'paste') this.openPasteModal()
		})
	}

	_setupDragDrop() {
		document.addEventListener('dragover', (e) => {
			e.preventDefault()
			document.body.classList.add('drag-over')
		})

		document.addEventListener('dragleave', (e) => {
			// Only remove the class when leaving the window entirely
			if (e.relatedTarget === null) {
				document.body.classList.remove('drag-over')
			}
		})

		document.addEventListener('drop', (e) => {
			e.preventDefault()
			document.body.classList.remove('drag-over')
			const file = e.dataTransfer.files[0]
			if (!file) return
			if (!file.name.toLowerCase().endsWith('.csv')) {
				alert('Please drop a CSV file (.csv)')
				return
			}
			this.processFile(file)
		})
	}

	showProgress(text, details = '') {
		this.progressText.textContent = text
		this.progressDetails.textContent = details
		this.progressPercent.textContent = '0%'
		this.progressFill.style.width = '0%'
		this.progressOverlay.classList.remove('hidden')
	}

	updateProgress(percent, details = '') {
		this.progressPercent.textContent = `${Math.round(percent)}%`
		this.progressFill.style.width = `${percent}%`
		if (details) this.progressDetails.textContent = details
	}

	hideProgress() {
		this.progressOverlay.classList.add('hidden')
	}

	// ── UPLOAD & PARSE ───────────────────────────────────────────────────────

	openPasteModal() {
		this.pasteOverlay.classList.remove('hidden')
		this.pasteTextarea.value = ''
		this.pasteTextarea.focus()
	}

	closePasteModal() {
		this.pasteOverlay.classList.add('hidden')
	}

	async loadPastedCSV() {
		const text = this.pasteTextarea.value.trim()
		if (!text) {
			alert('Please paste some CSV content first.')
			return
		}

		this.closePasteModal()
		await this.processCSVText(text, 'pasted_data.csv')
	}

	async processFile(file) {
		this.fileName = file.name
		this.fileNameSpan.textContent = this.fileName
		this.editedCells.clear()
		this.isEdited = false
		this.resetBtn.disabled = true
		this.rowCountSpan.textContent = 'Loading...'

		const showProgress = file.size > 1024 * 1024
		if (showProgress) {
			this.showProgress(
				'Parsing CSV...',
				`${this.fileName} (${(file.size / 1024 / 1024).toFixed(1)} MB)`
			)
		}

		try {
			const data = await this.parseFile(file, showProgress)
			await this.applyParsedData(data, showProgress)
		} catch (err) {
			if (showProgress) this.hideProgress()
			alert('Error processing CSV: ' + err.message)
		}
	}

	async processCSVText(text, fileName = 'pasted_data.csv') {
		this.fileName = fileName
		this.fileNameSpan.textContent = this.fileName
		this.editedCells.clear()
		this.isEdited = false
		this.resetBtn.disabled = true
		this.rowCountSpan.textContent = 'Loading...'

		const showProgress = text.length > 1024 * 1024
		if (showProgress) {
			this.showProgress(
				'Parsing CSV...',
				`${this.fileName} (${(text.length / 1024 / 1024).toFixed(1)} MB)`
			)
		}

		try {
			const data = await this.parseCSVText(text, showProgress)
			await this.applyParsedData(data, showProgress)
		} catch (err) {
			if (showProgress) this.hideProgress()
			alert('Error processing CSV: ' + err.message)
		}
	}

	parseCSVText(text, showProgress) {
		return new Promise((resolve, reject) => {
			Papa.parse(text, {
				header: false,
				skipEmptyLines: false,
				complete: (result) => {
					if (result.errors?.length && !result.data?.length) {
						reject(new Error(result.errors[0].message || 'Failed to parse CSV'))
						return
					}
					resolve(result.data)
				},
				error: reject,
				step: showProgress
					? (results) => {
							if (results.meta?.cursor) {
								const pct = Math.min((results.meta.cursor / text.length) * 70, 70)
								this.updateProgress(pct, `Parsing: ${Math.round(pct)}%`)
							}
					  }
					: undefined,
			})
		})
	}

	async applyParsedData(data, showProgress) {
		if (showProgress) this.updateProgress(75, 'Processing data...')

		this.csvData = data

		// Strip trailing empty rows
		while (
			this.csvData.length > 0 &&
			this.csvData[this.csvData.length - 1].every((c) => c === '')
		) {
			this.csvData.pop()
		}

		this.originalCsvData = structuredClone(this.csvData)
		this.updateRowCount()

		if (showProgress) this.updateProgress(90, 'Rendering table...')
		await new Promise((r) => requestAnimationFrame(r))

		this.renderTable()
		this.saveBtn.disabled = false
		this.resetBtn.disabled = false

		if (showProgress) {
			this.updateProgress(100, 'Done!')
			setTimeout(() => this.hideProgress(), 500)
		}
	}

	async parseFile(file, showProgress) {
		const numCores = navigator.hardwareConcurrency || 4

		// Large files: try parallel multi-worker parsing across all CPU cores
		if (file.size >= MULTI_WORKER_MIN_SIZE && numCores > 1) {
			try {
				return await this.parseWithMultipleWorkers(
					file,
					Math.min(numCores, 8),
					showProgress
				)
			} catch (e) {
				console.warn('Multi-worker parsing failed, falling back to single worker:', e)
			}
		}

		// Smaller files or fallback: PapaParse worker:true moves parsing off main thread
		return this.parseSingleWorker(file, showProgress)
	}

	parseSingleWorker(file, showProgress) {
		return new Promise((resolve, reject) => {
			Papa.parse(file, {
				worker: true,
				header: false,
				skipEmptyLines: false,
				complete: (result) => {
					// PapaParse occasionally returns empty when run in worker mode on some files
					if (result.data.length === 0 && !result.errors.length) {
						this.parseViaFileReader(file).then(resolve).catch(reject)
					} else {
						resolve(result.data)
					}
				},
				error: reject,
				step: showProgress
					? (results) => {
							if (results.meta?.cursor) {
								const pct = Math.min((results.meta.cursor / file.size) * 70, 70)
								this.updateProgress(pct, `Parsing: ${Math.round(pct)}%`)
							}
					  }
					: undefined,
			})
		})
	}

	parseViaFileReader(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = (e) => {
				try {
					resolve(
						Papa.parse(e.target.result, { header: false, skipEmptyLines: false }).data
					)
				} catch (err) {
					reject(err)
				}
			}
			reader.onerror = () => reject(new Error('FileReader failed'))
			reader.readAsText(file)
		})
	}

	// Split file into N chunks aligned to newline byte boundaries, then parse in parallel
	async parseWithMultipleWorkers(file, numWorkers, showProgress) {
		if (showProgress)
			this.updateProgress(10, `Splitting file across ${numWorkers} CPU cores...`)

		const chunks = await this.splitFileAtNewlines(file, numWorkers)

		if (showProgress)
			this.updateProgress(20, `Parsing with ${chunks.length} workers in parallel...`)

		// All chunks parse simultaneously — saturates all CPU cores
		const results = await Promise.all(
			chunks.map((blob, i) => this.runParserWorker(blob, i))
		)

		results.sort((a, b) => a.chunkIndex - b.chunkIndex)

		const merged = []
		for (const r of results) {
			if (r.data) merged.push(...r.data)
		}
		return merged
	}

	// Find newline byte (0x0A) boundaries by reading small 2 KB windows — avoids
	// loading the full file into memory just to find split points.
	async splitFileAtNewlines(file, numParts) {
		const targetSize = Math.ceil(file.size / numParts)
		const chunks = []
		let start = 0

		for (let i = 0; i < numParts - 1; i++) {
			if (start >= file.size) break

			const rawEnd = Math.min(start + targetSize, file.size)
			const winStart = Math.max(start, rawEnd - 1024)
			const winEnd = Math.min(file.size, rawEnd + 1024)

			const buf = await file.slice(winStart, winEnd).arrayBuffer()
			const bytes = new Uint8Array(buf)

			// Walk backward from the raw boundary to find a clean row end
			const midOffset = rawEnd - winStart
			let end = rawEnd
			for (let j = midOffset; j >= 0; j--) {
				if (bytes[j] === 0x0a) {
					end = winStart + j + 1
					break
				}
			}

			chunks.push(file.slice(start, end))
			start = end
		}

		if (start < file.size) chunks.push(file.slice(start))

		return chunks
	}

	runParserWorker(blob, chunkIndex) {
		return new Promise((resolve, reject) => {
			const worker = new Worker('csv-parser.worker.js')

			worker.onmessage = (e) => {
				worker.terminate()
				if (e.data.error) reject(new Error(e.data.error))
				else resolve(e.data)
			}

			worker.onerror = (e) => {
				worker.terminate()
				reject(new Error(e.message || 'Worker error'))
			}

			worker.postMessage({ blob, chunkIndex })
		})
	}

	// ── RENDER ───────────────────────────────────────────────────────────────

	renderTable() {
		// Tear down previous virtual scroll listener
		if (this._vsScrollHandler) {
			this.tableContainer.removeEventListener('scroll', this._vsScrollHandler)
			this._vsScrollHandler = null
		}

		if (this.csvData.length === 0) {
			this.tableContainer.innerHTML =
				'<div class="placeholder"><p>Drop a CSV file here, click <button type="button" class="placeholder-link" data-action="upload">Upload CSV</button>, or <button type="button" class="placeholder-link" data-action="paste">Paste CSV</button></p></div>'
			return
		}

		this._numCols = this.csvData[0]?.length || 0
		const totalDataRows = this.csvData.length - 1
		this._vsEnabled = totalDataRows > VIRTUAL_SCROLL_THRESHOLD

		const table = document.createElement('table')
		table.className = 'csv-table'
		table.appendChild(this._buildThead())

		const tbody = document.createElement('tbody')
		this._tbody = tbody
		table.appendChild(tbody)

		this.tableContainer.innerHTML = ''
		this.tableContainer.appendChild(table)

		// Single delegated listener covers all current and future cells
		this._setupTableDelegation(tbody)

		if (this._vsEnabled) {
			const viewHeight = this.tableContainer.clientHeight || 600
			const viewRows = Math.ceil(viewHeight / ROW_HEIGHT)
			this._vsStart = 0
			this._vsEnd = Math.min(totalDataRows, viewRows + OVERSCAN * 2)
			this._renderVirtualRows()
			this._setupVirtualScroll()
		} else {
			// Batch-build HTML string, then set once — single layout reflow
			tbody.innerHTML = this._buildRowsHTML(1, totalDataRows)
		}
	}

	_buildThead() {
		const thead = document.createElement('thead')
		const tr = document.createElement('tr')

		const thNum = document.createElement('th')
		thNum.textContent = '#'
		thNum.className = 'row-number'
		tr.appendChild(thNum)

		;(this.csvData[0] || []).forEach((header, i) => {
			const th = document.createElement('th')
			th.textContent = header || `Column ${i + 1}`
			tr.appendChild(th)
		})

		thead.appendChild(tr)
		return thead
	}

	_buildRowsHTML(from, to) {
		// Pre-allocate array to avoid repeated string concat
		const parts = new Array(to - from + 1)
		for (let i = from; i <= to; i++) {
			parts[i - from] = this._buildRowHTML(i)
		}
		return parts.join('')
	}

	_buildRowHTML(rowIndex) {
		const row = this.csvData[rowIndex]
		const numCols = this._numCols
		// Use data-index parity for stable alternating colors under virtual scroll
		const parity = rowIndex % 2 === 0 ? 'row-even' : 'row-odd'
		let html = `<tr class="${parity}"><td class="row-number">${rowIndex}</td>`

		for (let j = 0; j < numCols; j++) {
			const val = escapeHTML(row?.[j] ?? '')
			const cls = this.editedCells.has(`${rowIndex}:${j}`) ? ' class="edited"' : ''
			html += `<td${cls} data-row="${rowIndex}" data-col="${j}">${val}</td>`
		}

		return html + '</tr>'
	}

	// ── VIRTUAL SCROLL ───────────────────────────────────────────────────────

	_setupVirtualScroll() {
		this._vsScrollHandler = () => {
			// Throttle to one update per animation frame
			if (this._vsRafPending) return
			this._vsRafPending = true
			requestAnimationFrame(() => {
				this._vsRafPending = false
				// Don't destroy a cell that's being edited
				if (this._tbody?.querySelector('.editing')) return

				const scrollTop = this.tableContainer.scrollTop
				const height = this.tableContainer.clientHeight
				const totalRows = this.csvData.length - 1

				const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
				const end = Math.min(
					totalRows,
					Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN
				)

				if (start !== this._vsStart || end !== this._vsEnd) {
					this._vsStart = start
					this._vsEnd = end
					this._renderVirtualRows()
				}
			})
		}
		this.tableContainer.addEventListener('scroll', this._vsScrollHandler)
	}

	_renderVirtualRows() {
		if (!this._tbody) return

		const totalRows = this.csvData.length - 1
		const colSpan = this._numCols + 1
		const topH = this._vsStart * ROW_HEIGHT
		const botH = Math.max(0, (totalRows - this._vsEnd) * ROW_HEIGHT)

		let html = ''
		if (topH > 0) {
			html += `<tr class="vs-spacer"><td style="height:${topH}px;padding:0;border:none;" colspan="${colSpan}"></td></tr>`
		}
		html += this._buildRowsHTML(this._vsStart + 1, this._vsEnd)
		if (botH > 0) {
			html += `<tr class="vs-spacer"><td style="height:${botH}px;padding:0;border:none;" colspan="${colSpan}"></td></tr>`
		}

		this._tbody.innerHTML = html
	}

	// ── EVENT DELEGATION ─────────────────────────────────────────────────────

	_setupTableDelegation(tbody) {
		tbody.addEventListener('dblclick', (e) => {
			const cell = e.target.closest('td[data-row]')
			if (cell) this._startCellEdit(cell)
		})

		tbody.addEventListener('click', (e) => {
			const cell = e.target.closest('td[data-row]')
			if (!cell) return
			// Clear previous selection cheaply — only one cell can be selected at a time
			this.tableContainer.querySelector('td.selected')?.classList.remove('selected')
			cell.classList.add('selected')
		})
	}

	_startCellEdit(cell) {
		if (cell.classList.contains('editing')) return

		const originalText = cell.textContent
		cell.classList.add('editing')

		const input = document.createElement('input')
		input.type = 'text'
		input.value = originalText
		cell.innerHTML = ''
		cell.appendChild(input)
		input.focus()
		input.select()

		const rowIdx = parseInt(cell.dataset.row)
		const colIdx = parseInt(cell.dataset.col)

		let finished = false
		const finish = () => {
			if (finished) return
			finished = true
			const newValue = input.value
			cell.classList.remove('editing')
			cell.textContent = newValue

			if (!this.csvData[rowIdx]) this.csvData[rowIdx] = []
			while (this.csvData[rowIdx].length <= colIdx) this.csvData[rowIdx].push('')
			this.csvData[rowIdx][colIdx] = newValue

			const origVal = this.originalCsvData[rowIdx]?.[colIdx] ?? ''
			const key = `${rowIdx}:${colIdx}`

			if (newValue !== origVal) {
				this.editedCells.add(key)
				cell.classList.add('edited')
				this.isEdited = true
			} else {
				this.editedCells.delete(key)
				cell.classList.remove('edited')
				this.isEdited = this.editedCells.size > 0
			}

			this.updateSaveButtonState()
		}

		input.addEventListener('blur', finish)
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') finish()
			else if (e.key === 'Escape') {
				cell.classList.remove('editing')
				cell.textContent = originalText
			}
		})
	}

	// ── DATA OPS ─────────────────────────────────────────────────────────────

	updateRowCount() {
		const dataRows = this.csvData.length > 0 ? this.csvData.length - 1 : 0
		const cols = this.csvData[0]?.length || 0
		this.rowCountSpan.textContent = `${dataRows} rows × ${cols} columns`
	}

	updateSaveButtonState() {
		this.saveBtn.textContent = this.isEdited ? 'Save CSV *' : 'Save CSV'
		this.resetBtn.disabled = !this.isEdited || this.csvData.length === 0
	}

	resetChanges() {
		if (!this.isEdited || this.originalCsvData.length === 0) return
		if (!confirm('Reset all changes? This cannot be undone.')) return

		this.csvData = structuredClone(this.originalCsvData)
		this.editedCells.clear()
		this.isEdited = false
		this.renderTable()
		this.updateSaveButtonState()
	}

	saveCSV() {
		if (this.csvData.length === 0) return

		const estimatedSize = this.csvData.length * (this.csvData[0]?.length || 0) * 10
		const showProgress =
			this.csvData.length > 10000 || estimatedSize > 1024 * 1024

		if (showProgress) {
			this.showProgress('Generating CSV...', `Processing ${this.csvData.length} rows`)
			this.saveBtn.classList.add('loading')
		}

		setTimeout(
			() => {
				try {
					if (showProgress) this.updateProgress(30, 'Converting to CSV format...')
					const csv = Papa.unparse(this.csvData)

					if (showProgress) this.updateProgress(70, 'Creating download file...')
					const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })

					const filename = this.fileName || 'edited_data.csv'
					const finalFilename =
						this.isEdited && !filename.includes('_edited')
							? filename.replace('.csv', '_edited.csv')
							: filename

					if (showProgress) this.updateProgress(90, 'Preparing download...')

					setTimeout(
						() => {
							saveAs(blob, finalFilename)
							this.isEdited = false
							this.updateSaveButtonState()

							if (showProgress) {
								this.updateProgress(100, 'Download started!')
								setTimeout(() => {
									this.hideProgress()
									this.saveBtn.classList.remove('loading')
								}, 1000)
							}
						},
						showProgress ? 300 : 0
					)
				} catch (error) {
					if (showProgress) {
						this.hideProgress()
						this.saveBtn.classList.remove('loading')
					}
					alert('Error saving CSV: ' + error.message)
				}
			},
			showProgress ? 100 : 0
		)
	}

}

document.addEventListener('DOMContentLoaded', () => {
	new CSVEditor()
})
