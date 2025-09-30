class CSVEditor {
	constructor() {
		this.csvData = []
		this.originalCsvData = [] // Store original data for reset functionality
		this.fileName = ''
		this.isEdited = false
		this.editedCells = new Set() // Track edited cells by row:col coordinates

		this.initializeElements()
		this.bindEvents()
	}

	initializeElements() {
		this.fileInput = document.getElementById('csvFile')
		this.saveBtn = document.getElementById('saveBtn')
		this.resetBtn = document.getElementById('resetBtn')
		this.tableContainer = document.getElementById('tableContainer')
		this.fileNameSpan = document.getElementById('fileName')
		this.rowCountSpan = document.getElementById('rowCount')

		// Progress elements
		this.progressOverlay = document.getElementById('progressOverlay')
		this.progressText = document.getElementById('progressText')
		this.progressPercent = document.getElementById('progressPercent')
		this.progressFill = document.getElementById('progressFill')
		this.progressDetails = document.getElementById('progressDetails')
	}

	bindEvents() {
		this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e))
		this.saveBtn.addEventListener('click', () => this.saveCSV())
		this.resetBtn.addEventListener('click', () => this.resetChanges())

		// Handle keyboard shortcuts
		document.addEventListener('keydown', (e) => {
			if (e.ctrlKey && e.key === 's') {
				e.preventDefault()
				if (!this.saveBtn.disabled) {
					this.saveCSV()
				}
			} else if (e.ctrlKey && e.key === 'r') {
				e.preventDefault()
				if (!this.resetBtn.disabled) {
					this.resetChanges()
				}
			}
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
		if (details) {
			this.progressDetails.textContent = details
		}
	}

	hideProgress() {
		this.progressOverlay.classList.add('hidden')
	}

	handleFileUpload(event) {
		const file = event.target.files[0]
		if (!file) return

		this.fileName = file.name
		this.fileNameSpan.textContent = this.fileName
		
		// Clear edited cells state for new file
		this.editedCells.clear()
		this.isEdited = false
		this.resetBtn.disabled = true

		// Show progress for large files (>1MB)
		const showProgress = file.size > 1024 * 1024
		if (showProgress) {
			this.showProgress(
				'Reading file...',
				`Processing ${this.fileName} (${(file.size / 1024 / 1024).toFixed(
					1
				)}MB)`
			)
		}

		Papa.parse(file, {
			complete: (result) => {
				if (showProgress) {
					this.updateProgress(70, 'Processing CSV data...')
				}

				// Simulate processing time for visual feedback
				setTimeout(
					() => {
						this.csvData = result.data

						// Remove empty rows at the end
						while (
							this.csvData.length > 0 &&
							this.csvData[this.csvData.length - 1].every((cell) => cell === '')
						) {
							this.csvData.pop()
						}

						// Store original data for reset functionality
						this.originalCsvData = JSON.parse(JSON.stringify(this.csvData))

						if (showProgress) {
							this.updateProgress(90, 'Rendering table...')
						}

						setTimeout(
							() => {
								this.renderTable()
								this.updateRowCount()
								this.saveBtn.disabled = false
								this.resetBtn.disabled = false

								if (showProgress) {
									this.updateProgress(100, 'Complete!')
									setTimeout(() => this.hideProgress(), 500)
								}
							},
							showProgress ? 200 : 0
						)
					},
					showProgress ? 300 : 0
				)
			},
			header: false,
			skipEmptyLines: false,
			step: showProgress
				? (results, parser) => {
						// Update progress during parsing for large files
						if (results.meta && results.meta.cursor) {
							const progress = Math.min(
								(results.meta.cursor / file.size) * 60,
								60
							)
							this.updateProgress(
								progress,
								`Reading file: ${Math.round(progress)}%`
							)
						}
				  }
				: undefined,
			error: (error) => {
				if (showProgress) {
					this.hideProgress()
				}
				alert('Error parsing CSV: ' + error.message)
			},
		})
	}

	renderTable() {
		if (this.csvData.length === 0) {
			this.tableContainer.innerHTML =
				'<div class="placeholder"><p>Upload a CSV file to start editing</p></div>'
			return
		}

		const table = document.createElement('table')
		table.className = 'csv-table'

		// Create header
		const thead = document.createElement('thead')
		const headerRow = document.createElement('tr')

		// Add row number header
		const rowNumHeader = document.createElement('th')
		rowNumHeader.textContent = '#'
		rowNumHeader.className = 'row-number'
		headerRow.appendChild(rowNumHeader)

		// Add column headers
		if (this.csvData[0]) {
			this.csvData[0].forEach((header, index) => {
				const th = document.createElement('th')
				th.textContent = header || `Column ${index + 1}`
				th.title = th.textContent
				headerRow.appendChild(th)
			})
		}

		thead.appendChild(headerRow)
		table.appendChild(thead)

		// Create body
		const tbody = document.createElement('tbody')

		// Add data rows (skip header row)
		for (let i = 1; i < this.csvData.length; i++) {
			const row = document.createElement('tr')

			// Add row number
			const rowNumCell = document.createElement('td')
			rowNumCell.textContent = i
			rowNumCell.className = 'row-number'
			row.appendChild(rowNumCell)

			// Add data cells
			const rowData = this.csvData[i]
			const maxCols = this.csvData[0] ? this.csvData[0].length : rowData.length

			for (let j = 0; j < maxCols; j++) {
				const cell = document.createElement('td')
				cell.textContent = rowData[j] || ''
				cell.dataset.row = i
				cell.dataset.col = j
				cell.title = cell.textContent

				// Check if this cell was previously edited
				const cellKey = `${i}:${j}`
				if (this.editedCells.has(cellKey)) {
					cell.classList.add('edited')
				}

				// Make cell editable
				this.makeCellEditable(cell)

				row.appendChild(cell)
			}

			tbody.appendChild(row)
		}

		table.appendChild(tbody)
		this.tableContainer.innerHTML = ''
		this.tableContainer.appendChild(table)
	}

	makeCellEditable(cell) {
		cell.addEventListener('dblclick', () => {
			if (cell.classList.contains('editing')) return

			const originalValue = cell.textContent
			cell.classList.add('editing')

			const input = document.createElement('input')
			input.type = 'text'
			input.value = originalValue

			cell.innerHTML = ''
			cell.appendChild(input)

			input.focus()
			input.select()

			const finishEditing = () => {
				const newValue = input.value
				cell.classList.remove('editing')
				cell.textContent = newValue
				cell.title = newValue

				// Update data
				const row = parseInt(cell.dataset.row)
				const col = parseInt(cell.dataset.col)

				// Ensure the row exists in csvData
				while (this.csvData.length <= row) {
					this.csvData.push([])
				}

				// Ensure the column exists in the row
				while (this.csvData[row].length <= col) {
					this.csvData[row].push('')
				}

				this.csvData[row][col] = newValue

				// Get the original value from originalCsvData for comparison
				let originalValue = ''
				if (this.originalCsvData[row] && this.originalCsvData[row][col] !== undefined) {
					originalValue = this.originalCsvData[row][col]
				}

				const cellKey = `${row}:${col}`
				
				// Only mark as edited if the value actually changed from the original
				if (newValue !== originalValue) {
					// Track edited cell
					this.editedCells.add(cellKey)
					// Add edited class to cell for highlighting
					cell.classList.add('edited')
					this.isEdited = true
				} else {
					// Value was reverted back to original, remove from edited cells
					this.editedCells.delete(cellKey)
					// Remove edited class from cell
					cell.classList.remove('edited')
					
					// Check if there are any other edited cells to determine isEdited state
					this.isEdited = this.editedCells.size > 0
				}

				// Update save button state
				this.updateSaveButtonState()
			}

			input.addEventListener('blur', finishEditing)
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					finishEditing()
				} else if (e.key === 'Escape') {
					cell.classList.remove('editing')
					cell.textContent = originalValue
					cell.title = originalValue
				}
			})
		})

		// Single click to select cell
		cell.addEventListener('click', () => {
			// Remove selection from other cells
			document.querySelectorAll('.csv-table td.selected').forEach((c) => {
				c.classList.remove('selected')
			})

			if (!cell.classList.contains('row-number')) {
				cell.classList.add('selected')
			}
		})
	}

	updateRowCount() {
		const dataRows = this.csvData.length > 0 ? this.csvData.length - 1 : 0
		const cols = this.csvData[0] ? this.csvData[0].length : 0
		this.rowCountSpan.textContent = `${dataRows} rows × ${cols} columns`
	}

	updateSaveButtonState() {
		this.saveBtn.textContent = this.isEdited ? 'Save CSV *' : 'Save CSV'
		// Enable/disable reset button based on whether there are changes
		this.resetBtn.disabled = !this.isEdited || this.csvData.length === 0
	}

	resetChanges() {
		if (!this.isEdited || this.originalCsvData.length === 0) return

		// Show confirmation dialog
		if (!confirm('Are you sure you want to reset all changes? This action cannot be undone.')) {
			return
		}

		// Reset data to original
		this.csvData = JSON.parse(JSON.stringify(this.originalCsvData))
		
		// Clear edited cells tracking
		this.editedCells.clear()
		this.isEdited = false

		// Re-render table and update UI
		this.renderTable()
		this.updateSaveButtonState()
	}

	saveCSV() {
		if (this.csvData.length === 0) return

		// Show progress for large datasets (>10k rows or estimated size >1MB)
		const estimatedSize =
			this.csvData.length * (this.csvData[0]?.length || 0) * 10 // rough estimate
		const showProgress =
			this.csvData.length > 10000 || estimatedSize > 1024 * 1024

		if (showProgress) {
			this.showProgress(
				'Generating CSV...',
				`Processing ${this.csvData.length} rows`
			)
			this.saveBtn.classList.add('loading')
		}

		// Use setTimeout to allow UI to update
		setTimeout(
			() => {
				try {
					if (showProgress) {
						this.updateProgress(30, 'Converting data to CSV format...')
					}

					const csv = Papa.unparse(this.csvData)

					if (showProgress) {
						this.updateProgress(70, 'Creating download file...')
					}

					const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })

					// Use original filename or default
					const filename = this.fileName || 'edited_data.csv'
					const finalFilename =
						this.isEdited && !filename.includes('_edited')
							? filename.replace('.csv', '_edited.csv')
							: filename

					if (showProgress) {
						this.updateProgress(90, 'Preparing download...')
					}

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

// Initialize the CSV editor when the page loads
document.addEventListener('DOMContentLoaded', () => {
	new CSVEditor()
})
