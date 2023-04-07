class Pawn extends Piece {
	getVisibleFields() {
		var availableFields = [];

		for (var direction of this.getForwardDiagonalDirections()) {
			var fields = this.getFieldsInDirection(direction);
			if (fields.length > 0) {
				var aField = fields[0];
				availableFields.push(aField);
			}
		}

		return availableFields;
	}

	/*
		Forward step in case of emtpy field
		Forward double-step in case of empty field, if piece has not moved yet
	*/
	getSpecialMoves() {
		var moves = [];

		var fields = this.getFieldsInDirection(this.getForwardOrthogonalDirection());
		if (fields.length > 0 && this.board.getPiece(fields[0]) == null) {
			var movePart = new MovePart(this, this, this.field, fields[0]);
			moves.push(new GameMove(movePart));

			if (!this.board.hasMovedAlready(this) && fields.length > 1 && this.board.getPiece(fields[1]) == null) {
				var movePart = new MovePart(this, this, this.field, fields[1]);
				moves.push(new GameMove(movePart));
			}
		}

		return moves;
	}
	adjustMoves(moves) {
		var allMoves = [];
		for (var move of moves) {
			// regular capture
			var startField = move.mainMove.startField;
			var endField = move.mainMove.endField;
			var diagonalCapture = startField.column != endField.column && move.additionalMove != null;

			// en-passant capture
			var enPassant = false;
			var latestMove = this.board.getLatestMove();
			if (latestMove != null && latestMove.mainMove.endPiece instanceof Pawn
				&& latestMove.mainMove.startField.column == endField.column
				&& Math.abs(latestMove.mainMove.startField.row - endField.row) == 1
				&& Math.abs(latestMove.mainMove.endField.row - endField.row) == 1) {
				move.additionalMove = new MovePart(latestMove.mainMove.endPiece, null, latestMove.mainMove.endField, null);
				enPassant = true;
			}

			if (startField.column != endField.column && !diagonalCapture && !enPassant) {
				continue;
			}

			// promotions
			var endField = move.mainMove.endField;
			if (endField.row == 1 || endField.row == this.board.size) {
				var knight = new MovePart(this, new Knight(this.color, endField, this.board), this.field, endField);
				allMoves.push(new GameMove(knight, move.additionalMove, 'Promotion to knight'));

				var bishop = new MovePart(this, new Bishop(this.color, endField, this.board), this.field, endField);
				allMoves.push(new GameMove(bishop, move.additionalMove, 'Promotion to bishop'));

				var rook = new MovePart(this, new Rook(this.color, endField, this.board), this.field, endField);
				allMoves.push(new GameMove(rook, move.additionalMove, 'Promotion to rook'));

				var queen = new MovePart(this, new Queen(this.color, endField, this.board), this.field, endField);
				allMoves.push(new GameMove(queen, move.additionalMove, 'Promotion to queen'));
			} else {
				allMoves.push(move);
			}
		}
		return allMoves;
	}
}

class Bishop extends Piece {
	getVisibleFields() {
		var availableFields = [];
		for (var direction of this.getDiagonalDirections()) {
			for (var aField of this.getFieldsInDirection(direction)) {
				availableFields.push(aField);
				if (this.board.getPiece(aField) != null) {
					break;
				}
			}
		}
		return availableFields;
	}
}

class Rook extends Piece {
	getVisibleFields() {
		var availableFields = [];
		for (var direction of this.getOrthogonalDirections()) {
			for (var aField of this.getFieldsInDirection(direction)) {
				availableFields.push(aField);
				if (this.board.getPiece(aField) != null) {
					break;
				}
			}
		}
		return availableFields;
	}
}

class Knight extends Piece {
	static jumpDirection = new Direction(1, 2);

	getVisibleFields() {
		var availableFields = [];
		for (var aField of this.getFieldsInJump(Knight.jumpDirection)) {
			availableFields.push(aField);
		}
		return availableFields;
	}
}

class Queen extends Piece {
	getVisibleFields() {
		var availableFields = [];
		for (var direction of this.getStraightDirections()) {
			for (var aField of this.getFieldsInDirection(direction)) {
				availableFields.push(aField);
				if (this.board.getPiece(aField) != null) {
					break;
				}
			}
		}
		return availableFields;
	}
}

class King extends Piece {
	getVisibleFields() {
		var availableFields = [];
		for (var direction of this.getStraightDirections()) {
			var fields = this.getFieldsInDirection(direction);
			if (fields.length > 0) {
				var aField = fields[0];
				availableFields.push(fields[0]);
			}
		}
		return availableFields;
	}

	/*
		Castling
		TODO: refactor / prepare for Fischer random
	*/
	getSpecialMoves() {
		var moves = [];

		if (this.board.hasMovedAlready(this) == false) {
			var kingSideIntermediate = new BoardField(this.field.column + 1, this.field.row);
			var kingSideCastle = new BoardField(this.field.column + 2, this.field.row);
			var kingSideRook = this.board.getPiece(new BoardField(this.field.column + 3, this.field.row));
			if (kingSideRook != null && !this.board.hasMovedAlready(kingSideRook)
				&& this.board.getPiece(kingSideIntermediate) == null && this.board.getPiece(kingSideCastle) == null) {

				var castling = true;
				this.board.getAllVisibleFields(Colors.getOppositeColor(this.color)).forEach(aField => {
					if (aField.equals(this.field) || aField.equals(kingSideIntermediate) || aField.equals(kingSideCastle)) {
						castling = false;
					}
				});

				if (castling) {
					var kingMove = new MovePart(this, this, this.field, kingSideCastle);
					var rookMove = new MovePart(kingSideRook, kingSideRook, kingSideRook.field, kingSideIntermediate);
					moves.push(new GameMove(kingMove, rookMove, 'Castling'));
				}
			}

			var queenSideIntermediate = new BoardField(this.field.column - 1, this.field.row);
			var queenSideCastle = new BoardField(this.field.column - 2, this.field.row);
			var queenSideExtra = new BoardField(this.field.column - 3, this.field.row);
			var queenSideRook = this.board.getPiece(new BoardField(this.field.column - 4, this.field.row));
			if (queenSideRook != null && !this.board.hasMovedAlready(queenSideRook)
				&& this.board.getPiece(queenSideIntermediate) == null && this.board.getPiece(queenSideCastle) == null
				&& this.board.getPiece(queenSideExtra) == null) {

				var castling = true;
				this.board.getAllVisibleFields(Colors.getOppositeColor(this.color)).forEach(aField => {
					if (aField.equals(this.field) || aField.equals(queenSideIntermediate) || aField.equals(queenSideCastle)) {
						castling = false;
					}
				});

				if (castling) {
					var kingMove = new MovePart(this, this, this.field, queenSideCastle);
					var rookMove = new MovePart(queenSideRook, queenSideRook, queenSideRook.field, queenSideIntermediate);
					moves.push(new GameMove(kingMove, rookMove, 'Castling'));
				}
			}

		}

		return moves;
	}
}
