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

			if (!this.hasMovedAlready() && fields.length > 1 && this.board.getPiece(fields[1]) == null) {
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

	getCastlingMove(king, rook) {
		// final castling position is fixed
		var row = king.field.row;
		var newKingField = new BoardField(3, row);
		var newRookField = new BoardField(4, row);
		if (king.field.column < rook.field.column) {
			newKingField = new BoardField(7, row);
			newRookField = new BoardField(6, row);
		}

		var unsafeFields = this.board.getAllVisibleFields(Colors.getOppositeColor(this.color));
		for (var i = Math.min(king.field.column, newKingField.column); i <= Math.max(king.field.column, newKingField.column); i++) {
			// king must not be in check
			var aField = new BoardField(i, row);
			for (var field of unsafeFields) {
				if (field.equals(aField)) {
					return;
				}
			}
			// king must move through empty fields
			if (i != king.field.column && i != rook.field.column && this.board.getPiece(aField) != null) {
				return;
			}
		}
		for (var i = Math.min(rook.field.column, newRookField.column); i <= Math.max(rook.field.column, newRookField.column); i++) {
			// rook must move through empty fields
			var aField = new BoardField(i, row);
			if (i != king.field.column && i != rook.field.column && this.board.getPiece(aField) != null) {
				return;
			}
		}

		var kingPart = new MovePart(king, king, king.field, newKingField);
		var rookPart = new MovePart(rook, rook, rook.field, newRookField);
		return new GameMove(kingPart, rookPart, 'Castling');
	}
	getSpecialMoves() {
		var moves = [];

		if (this.hasMovedAlready() == false) {
			for (piece of this.board.pieces) {
				if (piece instanceof Rook && piece.color == this.color && !piece.hasMovedAlready()) {
					var move = this.getCastlingMove(this, piece);
					if (move != null) {
						moves.push(move);
					}
				}
			}
		}

		return moves;
	}
}
