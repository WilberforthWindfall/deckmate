import React, { useState, useEffect } from 'react';
import './App.css';
import { database, ref, set, onValue } from './firebaseConfig';

function initializeBoard() {
  const board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));

  const schachReihenfolge = [
    '\u265C',
    '\u265E',
    '\u265D',
    '\u265B',
    '\u265A',
    '\u265D',
    '\u265E',
    '\u265C',
  ];

  for (let i = 0; i < 8; i++) {
    board[0][i] = schachReihenfolge[i];
    board[1][i] = '\u265F';
  }

  for (let i = 0; i < 8; i++) board[7][i] = '\u25CF';
  for (let i = 0; i < 8; i += 2) board[5][i] = '\u25CF';
  for (let i = 1; i < 8; i += 2) board[6][i] = '\u25CF';

  return board;
}

export default function Deckmate() {
  const [board, setBoard] = useState(initializeBoard());
  const [selectedPiece, setSelectedPiece] = useState(null);

  useEffect(() => {
    console.log('📡 Verbinde mit Firebase...');
    const boardRef = ref(database, 'game/board');
    onValue(boardRef, (snapshot) => {
      const data = snapshot.val();
      console.log('📡 Empfangene Board-Daten:', data);

      if (
        Array.isArray(data) &&
        data.length === 8 &&
        data.every((row) => Array.isArray(row) && row.length === 8)
      ) {
        const transformedBoard = data.map(
          (row) => row.map((cell) => (cell === '_' ? null : cell)) // `_` zurück zu `null`
        );
        setBoard(transformedBoard);
      } else {
        console.warn(
          '⚠️ Fehlerhafte Board-Daten erkannt! Setze Standard-Board.'
        );
        resetBoard();
      }
    });
  }, []);

  function handleClick(row: number, col: number) {
    console.log(`🔥 handleClick aufgerufen für (${row}, ${col})`);

    if (!board || !board[row]) {
      console.warn('⚠️ Ungültige Board-Daten');
      return;
    }

    const piece = board[row][col];
    console.log(`🟢 Figur an (${row}, ${col}):`, piece);

    if (selectedPiece) {
      console.log(
        `🔄 Versuchter Zug von (${selectedPiece.row}, ${selectedPiece.col}) nach (${row}, ${col})`
      );
      if (isValidMove(selectedPiece.row, selectedPiece.col, row, col)) {
        movePiece(selectedPiece.row, selectedPiece.col, row, col);
      } else {
        console.warn('🚫 Ungültiger Zug!');
      }
      setSelectedPiece(null);
    } else if (piece !== null) {
      console.log('✅ Figur ausgewählt.');
      setSelectedPiece({ row, col });
    }
  }

  function isValidMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    const piece = board[fromRow][fromCol];
    if (!piece) return false;

    // ❌ NEU: Falls die Figur auf das gleiche Feld klickt -> Ungültiger Zug
    if (fromRow === toRow && fromCol === toCol) {
      return false;
    }

    if (piece === '●') {
      return isValidMannschaftMove(fromRow, fromCol, toRow, toCol);
    } else {
      return isValidOffizierMove(piece, fromRow, fromCol, toRow, toCol);
    }
  }

  function isValidMannschaftMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    const direction = -1; // Mannschaft zieht nach oben
    const rowDiff = toRow - fromRow;
    const colDiff = toCol - fromCol;

    // ❌ Rückwärtsbewegung verhindern
    if (rowDiff > 0) return false;

    // ✅ Normale Bewegung: 1 Feld diagonal nach vorne
    if (
      rowDiff === direction &&
      Math.abs(colDiff) === 1 &&
      board[toRow][toCol] === null
    ) {
      return true;
    }

    // ✅ Schlagbewegung: 2 Felder nach vorne, diagonal oder seitlich
    if (rowDiff === -2 && (colDiff === 2 || colDiff === -2 || colDiff === 0)) {
      const midRow = fromRow + (toRow - fromRow) / 2;
      const midCol = fromCol + (toCol - fromCol) / 2;

      // 🏴‍☠️ Prüfen, ob eine **gegnerische** Figur da ist UND das Ziel frei ist
      if (
        board[midRow][midCol] &&
        board[midRow][midCol] !== '●' &&
        board[toRow][toCol] === null
      ) {
        return true;
      }
    }

    // ✅ Seitliches Schlagen (neuer Code!)
    if (rowDiff === 0 && Math.abs(colDiff) === 2) {
      const midCol = fromCol + Math.sign(colDiff);

      // Eine gegnerische Figur muss dazwischen sein
      if (
        board[fromRow][midCol] &&
        board[fromRow][midCol] !== '●' &&
        board[toRow][toCol] === null
      ) {
        return true;
      }
    }

    return false;
  }

  function isValidOffizierMove(
    piece: Piece,
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    const targetPiece = board[toRow][toCol];

    // ❌ Falls auf dem Zielfeld eine eigene Figur steht -> Zug ungültig
    if (targetPiece && isSameTeam(piece, targetPiece)) {
      return false;
    }

    switch (piece) {
      case '♜': // Turm
        return isValidRookMove(fromRow, fromCol, toRow, toCol);
      case '♞': // Springer
        return isValidKnightMove(fromRow, fromCol, toRow, toCol);
      case '♝': // Läufer
        return isValidBishopMove(fromRow, fromCol, toRow, toCol);
      case '♛': // Dame
        return isValidQueenMove(fromRow, fromCol, toRow, toCol);
      case '♚': // König
        return isValidKingMove(fromRow, fromCol, toRow, toCol);
      case '♟': // Bauer
        return isValidPawnMove(fromRow, fromCol, toRow, toCol);
      default:
        return false;
    }
  }
  function isSameTeam(piece1: Piece, piece2: Piece): boolean {
    const mannschaft = '●';
    const offiziersFiguren = ['♜', '♞', '♝', '♛', '♚', '♟'];

    if (piece1 === mannschaft && piece2 === mannschaft) return true;
    if (offiziersFiguren.includes(piece1) && offiziersFiguren.includes(piece2))
      return true;
    return false;
  }

  function isValidRookMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    return (
      (fromRow === toRow || fromCol === toCol) &&
      isPathClear(fromRow, fromCol, toRow, toCol)
    );
  }

  function isValidBishopMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    return (
      Math.abs(fromRow - toRow) === Math.abs(fromCol - toCol) &&
      isPathClear(fromRow, fromCol, toRow, toCol)
    );
  }

  function isValidQueenMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    return (
      isValidRookMove(fromRow, fromCol, toRow, toCol) ||
      isValidBishopMove(fromRow, fromCol, toRow, toCol)
    );
  }

  function isValidKingMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    return Math.abs(fromRow - toRow) <= 1 && Math.abs(fromCol - toCol) <= 1;
  }

  function isValidKnightMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    const rowDiff = Math.abs(fromRow - toRow);
    const colDiff = Math.abs(fromCol - toCol);
    return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
  }

  function isValidPawnMove(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    const direction = 1; // Bauern ziehen nach unten
    if (
      fromCol === toCol &&
      toRow === fromRow + direction &&
      board[toRow][toCol] === null
    )
      return true;
    if (
      Math.abs(fromCol - toCol) === 1 &&
      toRow === fromRow + direction &&
      board[toRow][toCol] !== null
    )
      return true;
    return false;
  }
  function isPathClear(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    const rowStep = fromRow === toRow ? 0 : fromRow < toRow ? 1 : -1;
    const colStep = fromCol === toCol ? 0 : fromCol < toCol ? 1 : -1;
    let r = fromRow + rowStep,
      c = fromCol + colStep;

    while (r !== toRow || c !== toCol) {
      if (board[r][c] !== null) return false;
      r += rowStep;
      c += colStep;
    }
    return true;
  }

  function movePiece(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) {
    setBoard((prevBoard) => {
      const newBoard = prevBoard.map((row) => [...row]);
      const piece = newBoard[fromRow][fromCol];

      // 🔹 Falls es ein Sprung (Schlagen) ist, entferne die geschlagene Figur
      if (Math.abs(toRow - fromRow) === 2 || Math.abs(toCol - fromCol) === 2) {
        const midRow = fromRow + Math.sign(toRow - fromRow);
        const midCol = fromCol + Math.sign(toCol - fromCol);
        newBoard[midRow][midCol] = '_'; // Statt `null`
      }

      newBoard[toRow][toCol] = piece;
      newBoard[fromRow][fromCol] = '_'; // Statt `null`

      console.log('📡 Speichere neues Board in Firebase:', newBoard);

      // 🔹 Stelle sicher, dass das `board` immer 8x8 bleibt
      const completeBoard = Array(8)
        .fill(null)
        .map((_, rIdx) =>
          Array(8)
            .fill(null)
            .map((_, cIdx) => newBoard[rIdx]?.[cIdx] ?? '_')
        );

      set(ref(database, 'game/board'), completeBoard);
      return completeBoard;
    });
  }

  function resetBoard() {
    const defaultBoard = initializeBoard();
    setBoard(defaultBoard);
    set(ref(database, 'game/board'), defaultBoard);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#ddd',
      }}
    >
      <h1
        style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}
      >
        Deckmate: Das Spiel
      </h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 60px)',
          gridTemplateRows: 'repeat(8, 60px)',
          width: '480px',
          height: '480px',
          border: '4px solid black',
        }}
      >
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
                backgroundColor:
                  (rIdx + cIdx) % 2 === 0 ? '#eeeed2' : '#769656',
                outline:
                  selectedPiece?.row === rIdx && selectedPiece?.col === cIdx
                    ? '3px solid red'
                    : 'none',
                cursor: piece !== null ? 'pointer' : 'default',
              }}
              onClick={() => handleClick(rIdx, cIdx)}
            >
              {piece}
            </div>
          ))
        )}
      </div>
      <button
        onClick={resetBoard}
        style={{
          marginTop: '10px',
          padding: '10px',
          fontSize: '16px',
          cursor: 'pointer',
        }}
      >
        Board zurücksetzen
      </button>
    </div>
  );
}
