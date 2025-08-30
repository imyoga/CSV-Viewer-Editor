"use client"

import type React from "react"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Upload, Download, Search, Filter, FileText, Database } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type CSVData = string[][]

export default function CSVViewerEditor() {
  const [csvData, setCsvData] = useState<CSVData>([])
  const [fileName, setFileName] = useState<string>("")
  const [searchTerm, setSearchTerm] = useState("")
  const [filterColumn, setFilterColumn] = useState<string>("all")
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
  const [editValue, setEditValue] = useState("")

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type === "text/csv") {
      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        const rows = text
          .split("\n")
          .map((row) => row.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")))
          .filter((row) => row.some((cell) => cell.length > 0))
        setCsvData(rows)
      }
      reader.readAsText(file)
    }
  }

  const filteredData = useMemo(() => {
    if (!csvData.length || !searchTerm) return csvData

    return csvData.filter((row, index) => {
      if (index === 0) return true // Keep header row

      if (filterColumn === "all") {
        return row.some((cell) => cell.toLowerCase().includes(searchTerm.toLowerCase()))
      } else {
        const colIndex = Number.parseInt(filterColumn)
        return row[colIndex]?.toLowerCase().includes(searchTerm.toLowerCase())
      }
    })
  }, [csvData, searchTerm, filterColumn])

  const handleCellEdit = (rowIndex: number, colIndex: number, value: string) => {
    const newData = [...csvData]
    newData[rowIndex][colIndex] = value
    setCsvData(newData)
    setEditingCell(null)
  }

  const exportToCSV = () => {
    const csvContent = csvData.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n")

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName || "exported_data.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportToJSON = () => {
    if (!csvData.length) return

    const headers = csvData[0]
    const jsonData = csvData.slice(1).map((row) => {
      const obj: Record<string, string> = {}
      headers.forEach((header, index) => {
        obj[header] = row[index] || ""
      })
      return obj
    })

    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName.replace(".csv", ".json") || "exported_data.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-foreground">CSV Viewer & Editor</h1>
          <p className="text-muted-foreground text-lg">Upload, analyze, and export your CSV data with ease</p>
        </div>

        {/* Upload Section */}
        {!csvData.length && (
          <Card className="border-2 border-dashed border-border hover:border-primary/50 transition-colors">
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <Upload className="h-6 w-6" />
                Upload CSV File
              </CardTitle>
              <CardDescription>Select a CSV file to start viewing and editing your data</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Input type="file" accept=".csv" onChange={handleFileUpload} className="max-w-md mx-auto" />
            </CardContent>
          </Card>
        )}

        {/* Data View */}
        {csvData.length > 0 && (
          <>
            {/* Controls */}
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <CardTitle className="text-xl">{fileName}</CardTitle>
                    <Badge variant="secondary">
                      {csvData.length - 1} rows × {csvData[0]?.length || 0} columns
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={exportToCSV} variant="outline" size="sm">
                      <Download className="h-4 w-4 mr-2" />
                      Export CSV
                    </Button>
                    <Button onClick={exportToJSON} variant="outline" size="sm">
                      <Database className="h-4 w-4 mr-2" />
                      Export JSON
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search data..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <Select value={filterColumn} onValueChange={setFilterColumn}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All columns</SelectItem>
                        {csvData[0]?.map((header, index) => (
                          <SelectItem key={index} value={index.toString()}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Data Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        {csvData[0]?.map((header, index) => (
                          <TableHead key={index} className="font-semibold bg-muted/50">
                            {header}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredData.slice(1).map((row, rowIndex) => (
                        <TableRow key={rowIndex} className="hover:bg-muted/30">
                          {row.map((cell, colIndex) => (
                            <TableCell
                              key={colIndex}
                              className="cursor-pointer hover:bg-accent/10 transition-colors"
                              onClick={() => {
                                setEditingCell({ row: rowIndex + 1, col: colIndex })
                                setEditValue(cell)
                              }}
                            >
                              {editingCell?.row === rowIndex + 1 && editingCell?.col === colIndex ? (
                                <Input
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => handleCellEdit(rowIndex + 1, colIndex, editValue)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      handleCellEdit(rowIndex + 1, colIndex, editValue)
                                    }
                                    if (e.key === "Escape") {
                                      setEditingCell(null)
                                    }
                                  }}
                                  className="h-8 text-sm"
                                  autoFocus
                                />
                              ) : (
                                <span className="text-sm">{cell}</span>
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Upload New File */}
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="flex items-center justify-center gap-4">
                  <span className="text-muted-foreground">Want to analyze a different file?</span>
                  <Input type="file" accept=".csv" onChange={handleFileUpload} className="max-w-xs" />
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
