class ChessBoard {
	moves = [];
	pieces = [];
	size = 8;
	ended = false;
	winner = null;

	activeColor = Colors.LIGHT;

	constructor() {
		this.pieces.push(new Rook(Colors.LIGHT, new BoardField(1, 1), this));
		this.pieces.push(new Knight(Colors.LIGHT, new BoardField(2, 1), this));
		this.pieces.push(new Bishop(Colors.LIGHT, new BoardField(3, 1), this));
		this.pieces.push(new Queen(Colors.LIGHT, new BoardField(4, 1), this));
		this.pieces.push(new King(Colors.LIGHT, new BoardField(5, 1), this));
		this.pieces.push(new Bishop(Colors.LIGHT, new BoardField(6, 1), this));
		this.pieces.push(new Knight(Colors.LIGHT, new BoardField(7, 1), this));
		this.pieces.push(new Rook(Colors.LIGHT, new BoardField(8, 1), this));

		this.pieces.push(new Rook(Colors.DARK, new BoardField(1, this.size), this));
		this.pieces.push(new Knight(Colors.DARK, new BoardField(2, this.size), this));
		this.pieces.push(new Bishop(Colors.DARK, new BoardField(3, this.size), this));
		this.pieces.push(new Queen(Colors.DARK, new BoardField(4, this.size), this));
		this.pieces.push(new King(Colors.DARK, new BoardField(5, this.size), this));
		this.pieces.push(new Bishop(Colors.DARK, new BoardField(6, this.size), this));
		this.pieces.push(new Knight(Colors.DARK, new BoardField(7, this.size), this));
		this.pieces.push(new Rook(Colors.DARK, new BoardField(8, this.size), this));

		for (var i = 1; i <= this.size; i++) {
			this.pieces.push(new Pawn(Colors.LIGHT, new BoardField(i, 2), this));
		}
		for (var i = 1; i <= this.size; i++) {
			this.pieces.push(new Pawn(Colors.DARK, new BoardField(i, this.size - 1), this));
		}
	}

	getPiece(field) {
		for (var piece of this.pieces) {
			if (piece.field.equals(field)) {
				return piece;
			}
		}
		return null;
	}

	getLatestMove() {
		if (this.moves.length == 0) {
			return null;
		} else {
			return this.moves[this.moves.length - 1];
		}
	}
	hasMovedAlready(piece) {
		for (var move of this.moves) {
			if (piece == move.mainMove.startPiece || piece == move.mainMove.endPiece) {
				return true;
			}
			if (move.additionalMove != null) {
				if (piece == move.additionalMove.startPiece || piece == move.additionalMove.endPiece) {
					return true;
				}
			}
		}
		return false;
	}

	isFieldValid(field) {
		return field.column >= 1 && field.column <= 8 && field.row >= 1 && field.row <= 8;
	}
	isChecked(color) {
		var checked = false;
		var kingField;
		var enemyFields = [];

		for (var piece of this.pieces) {
			if (piece.color == color && piece instanceof King) {
				kingField = piece.field;
			}
		}

		for (var field of this.getAllVisibleFields(Colors.getOppositeColor(color))) {
			if (field.equals(kingField)) {
				checked = true;
			}
		}

		return checked;
	}

	getAllVisibleFields(color) {
		var visibleFields = [];
		for (piece of this.pieces) {
			if (piece.color == color) {
				visibleFields = visibleFields.concat(piece.getVisibleFields(this, piece.field));
			}
		}
		return visibleFields;
	}

	doMovePart(move) {
		if (move.endPiece != move.startPiece) {
			this.pieces = this.pieces.filter(i => i != move.startPiece)
			if (move.endPiece != null) {
				this.pieces.push(move.endPiece);
				move.endPiece.field = move.endField;
			}
		} else {
			move.startPiece.field = move.endField;
		}
	}
	undoMovePart(move) {
		if (move.endPiece != move.startPiece) {
			this.pieces.push(move.startPiece);
			move.startPiece.field = move.startField;
			if (move.endPiece != null) {
				this.pieces = this.pieces.filter(i => i != move.endPiece)
			}
		} else {
			move.startPiece.field = move.startField;
		}
	}

	doMove(move) {
		this.doMovePart(move.mainMove);
		if (move.additionalMove != null) {
			this.doMovePart(move.additionalMove);
		}
	}
	undoMove(move) {
		this.undoMovePart(move.mainMove);
		if (move.additionalMove != null) {
			this.undoMovePart(move.additionalMove);
		}
	}

	isMoveWithoutCheck(move) {
		this.doMove(move)
		var withoutCheck = !this.isChecked(move.getColor());
		this.undoMove(move)
		return withoutCheck;
	}
	movePiece(chessMove) {
		this.doMove(chessMove);
		this.moves.push(chessMove);
		this.activeColor = Colors.getOppositeColor(chessMove.getColor());

		console.log("Action: %s", chessMove);
		this.evaluateEnd();
	}
	evaluateEnd() {
		var noMove = true;
		for (var piece of this.pieces) {
			if (piece.color == this.activeColor) {
				if (piece.getValidMoves().length != 0) {
					noMove = false;
					break;
				}
			}
		}
		if (noMove) {
			this.ended = true;
			if (this.isChecked(this.activeColor)) {
				this.winner = Colors.getOppositeColor(this.activeColor).name;
				console.log("Game ended: player with %s pieces won", this.winner);
			} else {
				console.log("Game ended: draw");
			}
		}
	}

}
