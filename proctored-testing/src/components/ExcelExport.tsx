'use client';

import * as XLSX from 'xlsx';
import { LeaderboardEntry } from '@/components/LeaderboardTable';

interface ExcelExportProps {
  data: LeaderboardEntry[];
  filename?: string;
}

export default function ExcelExport({ data, filename = 'leaderboard_results.xlsx' }: ExcelExportProps) {
  const exportToExcel = () => {
    // fields: Rank, Name, Email, Score, AI Risk, Round Status
    const formattedData = data.map(entry => ({
      Rank: entry.rank,
      Name: entry.name,
      Email: entry.email,
      Score: `${entry.score} / ${entry.total}`,
      'AI Risk': entry.aiSeverity || 'N/A',
      'Round Status': entry.roundStatus || 'Pending'
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
    XLSX.writeFile(workbook, filename);
  };

  return (
    <button className="btn btn-success" onClick={exportToExcel}>
      ⬇ Download Excel
    </button>
  );
}
