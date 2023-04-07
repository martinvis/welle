class ChessColor {
	constructor(name, columnDirection) {
		this.name = name;
		this.columnDirection = columnDirection;
	}
}

class Colors {
	static LIGHT = new ChessColor('light', 1);
	static DARK = new ChessColor('dark', -1);

	static getOppositeColor(color) {
		return color == this.LIGHT ? this.DARK : this.LIGHT;
	}
}

/*
	Represents column/row difference between two fields (relative movement)
*/
class Direction {
	constructor(columnMove, rowMove) {
		this.columnMove = columnMove;
		this.rowMove = rowMove;
	}

	equals(direction) {
		return direction.columnMove == this.columnMove && direction.rowMove == this.rowMove;
	}
	toString() {
		return "(" + this.columnMove + "," + this.rowMove + ")";
	}
}

class Directions {
	static getAllCombinations(columnMove, rowMove) {
		var directions = [];

		for (var i of new Set([-1*columnMove, columnMove])) {
			for (var j of new Set([-1*rowMove, rowMove])) {
				directions.push(new Direction(i, j));
				if (columnMove != rowMove) {
					directions.push(new Direction(j, i));
				}
			}
		}

		return directions;
	}
}

class BoardField {
	constructor(column, row) {
		this.column = column;
		this.row = row;
	}

	nextFieldInDirection(direction) {
		var field =  new BoardField(this.column + direction.columnMove, this.row + direction.rowMove);
		return field;
	}

	equals(field) {
		return field.column == this.column && field.row == this.row;
	}
	toString() {
		return String.fromCharCode(64 + this.column) + this.row;
	}
}

/*
	Represents move of a single piece in isolation
	When endPiece is null, piece was captured
	When startPiece and endPiece differ, piece was promoted
*/
class MovePart {
	constructor(startPiece, endPiece, startField, endField) {
		this.startPiece = startPiece;
		this.endPiece = endPiece;
		this.startField = startField;
		this.endField = endField;
	}

	toString() {
		if (this.startPiece == this.endPiece) {
			return "Move " + this.startPiece + " from " + this.startField + " to " + this.endField;
		} else if (this.endPiece != null) {
			return "Promote " + this.startPiece + " on " + this.startField + " to " + this.endPiece + " on " + this.endField;
		} else {
			return this.startPiece + " capture on " + this.startField;
		}
	}
}

/*
	Represents any game move
	Main move is for moved piece, additional move is usually for captured piece
*/
class GameMove {
	constructor(mainMove, additionalMove, label='Normal') {
		this.mainMove = mainMove;
		this.additionalMove = additionalMove;
		this.label = label;
	}

	getColor() {
		return this.mainMove.startPiece.color;	
	}

	toString() {
		var string = "" + this.mainMove;
		if (this.additionalMove != null) {
			string = string + " (" + this.additionalMove + ")";
		}
		return string;
	}

	getStartField() {
		return this.mainMove.startField;
	}
	getEndField() {
		return this.mainMove.endField;
	}
}

/*
	Represents abstract piece
*/
class Piece {
	constructor(color, field, board) {
		this.color = color;
		this.field = field;
		this.board = board;
	}

	getDiagonalDirections() {
		return Directions.getAllCombinations(1, 1);
	}
	getOrthogonalDirections() {
		return Directions.getAllCombinations(0, 1);
	}
	getStraightDirections() {
		var directions = [];
		directions = directions.concat(this.getDiagonalDirections());
		directions = directions.concat(this.getOrthogonalDirections());
		return directions;
	}
	getJumpDirections(firstDistance, secondDistance) {
		return Directions.getAllCombinations(firstDistance, secondDistance);
	}

	getForwardDiagonalDirections() {
		var directions = [];
		directions.push(new Direction(-1, this.color.columnDirection));
		directions.push(new Direction(1, this.color.columnDirection));
		return directions;
	}
	getForwardOrthogonalDirection() {
		return new Direction(0, this.color.columnDirection);
	}
	getForwardAllDirections() {
		var directions = [];
		directions.push(this.getForwardDiagonalDirections());
		directions.push(this.getForwardOrthogonalDirection());
		return directions;
	}

	getFieldsInDirection(direction) {
		var fields = [];

		var aField = this.field.nextFieldInDirection(direction);
		while (this.board.isFieldValid(aField)) {
			fields.push(aField);
			aField = aField.nextFieldInDirection(direction);
		}

		return fields;
	}
	getFieldsInJump(direction) {
		var fields = [];

		var directions = Directions.getAllCombinations(direction.columnMove, direction.rowMove);
		for (var direction of directions) {
			var aField = this.field.nextFieldInDirection(direction);
			if (this.board.isFieldValid(aField)) {
				fields.push(aField);
			}
		}

		return fields;
	}

	getVisibleFields() {
	}

	getStandardMoves() {
		var moves = [];

		var fields = this.getVisibleFields();
		for (var field of fields) {
			var piece = this.board.getPiece(field);
			if (piece != null && piece.color == this.color) {
				continue;
			} else {
				var mainPart = new MovePart(this, this, this.field, field);
				if (piece != null) {
					var capturePart = new MovePart(piece, null, piece.field, null);
					moves.push(new GameMove(mainPart, capturePart));
				} else {
					moves.push(new GameMove(mainPart));
				}
			}
		}

		return moves;
	}
	getSpecialMoves() {
		return [];
	}
	getValidMoves() {
		var moves = this.getStandardMoves();
		moves = moves.concat(this.getSpecialMoves());
		moves = moves.filter(i => this.isMoveValid(i));
		moves = this.adjustMoves(moves);
		return moves;
	}
	isMoveValid(move) {
		return this.board.isMoveWithoutCheck(move);
	}
	adjustMoves(moves) {
		return moves;
	}

	toString() {
		return this.constructor.name + "/" + this.color.name;
	}
}
