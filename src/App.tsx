import { useState, useEffect } from 'react';
import './App.css';
import { database, ref, set, onValue } from './firebaseConfig';

type Piece = '●' | '♟' | '♜' | '♞' | '♝' | '♛' | '♚' | null;

function initializeBoard(): Piece[][] {
  const board: Piece[][] = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));

  const schachReihenfolge: Piece[] = ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'];
  for (let i = 0; i < 8; i++) {
    board[0][i] = schachReihenfolge[i];
    board[1][i] = '♟';
  }

  for (let i = 0; i < 8; i++) board[7][i] = '●';
  for (let i = 0; i < 8; i += 2) board[5][i] = '●';
  for (let i = 1; i < 8; i += 2) board[6][i] = '●';

  return board;
}

export default function Deckmate() {
  const [board, setBoard] = useState<Piece[][]>(initializeBoard());
  const [selectedPiece, setSelectedPiece] = useState<{ row: number; col: number } | null>(null);

  useEffect(() => {
    const boardRef = ref(database, 'game/board');
    onValue(boardRef, (snapshot) => {
      const data = snapshot.val();
      if (Array.isArray(data) && data.length === 8 && data.every((row) => Array.isArray(row) && row.length === 8)) {
        const transformedBoard: Piece[][] = data.map((row: any[]) =>
          row.map((cell: any) => (cell === '_' ? null : (cell as Piece)))
        );
        setBoard(transformedBoard);
      } else {
        resetBoard();
      }
    });
  }, []);

  function handleClick(row: number, col: number) {
    const piece = board[row][col];
    if (selectedPiece) {
      if (isValidMove(selectedPiece.row, selectedPiece.col, row, col)) {
        movePiece(selectedPiece.row, selectedPiece.col, row, col);
      }
      setSelectedPiece(null);
    } else if (piece !== null) {
      setSelectedPiece({ row, col });
    }
  }

  function isValidMove(fromRow: number, fromCol: number, toRow: number, toCol: number): boolean {
    const piece = board[fromRow][fromCol];
    if (!piece) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    return piece === '●'
      ? isValidMannschaftMove(fromRow, fromCol, toRow, toCol)
      : isValidOffizierMove(piece, fromRow, fromCol, toRow, toCol);
  }

  function isValidMannschaftMove(fromRow: number, fromCol: number, toRow: number, toCol: number): boolean {
    const direction = -1;
    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;
    if (rowDiff > 0) return false;

    if (rowDiff === direction && Math.abs(colDiff) === 1 && board[toRow][toCol] === null) {
      return true;
    }

    if (rowDiff === -2 && (colDiff === 2 || colDiff === -2 || colDiff === 0)) {
      const midRow = fromRow + (toRow - fromRow) / 2;
      const midCol = fromCol + (toCol - fromCol) / 2;
      if (board[midRow][midCol] && board[midRow][midCol] !== '●' && board[toRow][toCol] === null) {
        return true;
      }
    }

    if (rowDiff === 0 && Math.abs(colDiff) === 2) {
      const midCol = fromCol + Math.sign(colDiff);
      if (board[fromRow][midCol] && board[fromRow][midCol] !== '●' && board[toRow][toCol] === null) {
        return true;
      }
    }

    return false;
  }

  function isValidOffizierMove(piece: Piece, fromRow: number, fromCol: number, toRow: number, toCol: number): boolean {
    const targetPiece = board[toRow][toCol];
    if (targetPiece && isSameTeam(piece, targetPiece)) return false;

    switch (piece) {
      case '♜': return isValidRookMove(fromRow, fromCol, toRow, toCol);
      case '♞': return isValidKnightMove(fromRow, fromCol, toRow, toCol);
      case '♝': return isValidBishopMove(fromRow, fromCol, toRow, toCol);
      case '♛': return isValidQueenMove(fromRow, fromCol, toRow, toCol);
      case '♚': return isValidKingMove(fromRow, fromCol, toRow, toCol);
      case '♟': return isValidPawnMove(fromRow, fromCol, toRow, toCol);
      default: return false;
    }
  }

  function isSameTeam(piece1: Piece, piece2: Piece): boolean {
    const mannschaft = '●';
    const offiziere = ['♜', '♞', '♝', '♛', '♚', '♟'];
    return (piece1 === mannschaft && piece2 === mannschaft) || (offiziere.includes(piece1!) && offiziere.includes(piece2!));
  }

  function isValidRookMove(fromRow: number, fromCol: number, toRow: number, toCol: number) {
    return (fromRow === toRow || fromCol === toCol) && isPathClear(fromRow, fromCol, toRow, toCol);
  }

  function isValidBishopMove(fromRow: number, fromCol: number, toRow: number, toCol: number) {
    return Math.abs(fromRow - toRow) === Math.abs(fromCol - toCol) && isPathClear(fromRow, fromCol, toRow, toCol);
  }

  function isValidQueenMove(fromRow: number, fromCol: number, toRow: number, toCol: number) {
    return isValidRookMove(fromRow, fromCol, toRow, toCol) || isValidBishopMove(fromRow, fromCol, toRow, toCol);
  }

  function isValidKingMove(fromRow: number, fromCol: number, toRow: number, toCol: number) {
    return Math.abs(fromRow - toRow) <= 1 && Math.abs(fromCol - toCol) <= 1;
  }

  function isValidKnightMove(fromRow: number, fromCol: number, toRow: number, toCol: number) {
    const rowDiff = Math.abs(fromRow - toRow);
    const colDiff = Math.abs(fromCol - toCol);
    return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
  }

  function isValidPawnMove(fromRow: number, fromCol: number, toRow: number, toCol: number) {
    const direction = 1;
    if (fromCol === toCol && toRow === fromRow + direction && board[toRow][toCol] === null) return true;
    if (Math.abs(fromCol - toCol) === 1 && toRow === fromRow + direction && board[toRow][toCol] !== null) return true;
    return false;
  }

  function isPathClear(fromRow: number, fromCol: number, toRow: number, toCol: number) {
    const rowStep = fromRow === toRow ? 0 : fromRow < toRow ? 1 : -1;
    const colStep = fromCol === toCol ? 0 : fromCol < toCol ? 1 : -1;
    let r = fromRow + rowStep, c = fromCol + colStep;
    while (r !== toRow || c !== toCol) {
      if (board[r][c] !== null) return false;
      r += rowStep; c += colStep;
    }
    return true;
  }

  function movePiece(fromRow: number, fromCol: number, toRow: number, toCol: number) {
    setBoard((prevBoard) => {
      const newBoard = prevBoard.map((row) => [...row]) as Piece[][];
      const piece = newBoard[fromRow][fromCol];
  
      if (Math.abs(toRow - fromRow) === 2 || Math.abs(toCol - fromCol) === 2) {
        const midRow = fromRow + Math.sign(toRow - fromRow);
        const midCol = fromCol + Math.sign(toCol - fromCol);
        newBoard[midRow][midCol] = null;
      }
  
      newBoard[toRow][toCol] = piece;
      newBoard[fromRow][fromCol] = null;
  
      const completeBoard = Array(8)
        .fill(null)
        .map((_, rIdx) =>
          Array(8)
            .fill(null)
            .map((_, cIdx) => newBoard[rIdx]?.[cIdx] ?? '_')
        );
  
      set(ref(database, 'game/board'), completeBoard);
      return newBoard;
    });
  }
  

  function resetBoard() {
    const defaultBoard = initializeBoard();
    setBoard(defaultBoard);
    set(ref(database, 'game/board'), defaultBoard);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#ddd' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>Deckmate: Das Spiel</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 60px)', gridTemplateRows: 'repeat(8, 60px)', width: '480px', height: '480px', border: '4px solid black' }}>
        {board.map((row, rIdx) =>
          row.map((piece, cIdx) => (
            <div
              key={`${rIdx}-${cIdx}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '60px',
                height: '60px',
                fontSize: '20px',
                fontWeight: 'bold',
                border: '1px solid black',
                backgroundColor: (rIdx + cIdx) % 2 === 0 ? '#eeeed2' : '#769656',
                outline: selectedPiece?.row === rIdx && selectedPiece?.col === cIdx ? '3px solid red' : 'none',
                cursor: piece !== null ? 'pointer' : 'default',
              }}
              onClick={() => handleClick(rIdx, cIdx)}
            >
              {piece}
            </div>
          ))
        )}
      </div>
      <button onClick={resetBoard} style={{ marginTop: '10px', padding: '10px', fontSize: '16px', cursor: 'pointer' }}>
        Board zurücksetzen
      </button>
    </div>
  );
}
